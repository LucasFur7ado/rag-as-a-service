import "server-only";

import { after } from "next/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { eq } from "drizzle-orm";
import type { AuthContext, RateLimitErrorBody } from "@rag/shared";
import { getDb } from "../db";
import { apiKeys as apiKeysTable } from "../db/schema";
import { clerkAuthorizedParties, clerkIssuer, MissingEnvError } from "../env";
import { looksLikeApiKey, sha256Hex } from "../services/apikeys";
import { enforceRateLimit, type RateLimitResult } from "../services/ratelimit";
import { recordEvent } from "../services/analytics";
import { ApiError } from "./errors";
import { LAST_USED_THROTTLE_MS, RATE_LIMIT_WINDOW_MS } from "../config";

/**
 * Unified authentication for the API.
 *
 * Two credential types resolve to the same {@link AuthContext}:
 * - a Clerk session JWT (dashboard), verified against Clerk's JWKS;
 * - an API key (`Authorization: Bearer rag_live_…` or `X-API-Key`), verified by
 *   SHA-256 hash lookup.
 *
 * `requireAuth` accepts EITHER (the public product surface); `requireSession`
 * accepts ONLY a session (API-key management and analytics must not be
 * reachable with an API key). API-key traffic is rate-limited before any
 * downstream work.
 */

// --- Clerk session verification --------------------------------------------

// Cache one remote JWKS resolver per issuer. `createRemoteJWKSet` returns a
// function that additionally caches the fetched keys in-memory and refreshes
// them on rotation, so this map is effectively a per-instance key cache.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string) {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", issuer));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

/** Clerk session-token claims we care about. */
interface ClerkClaims extends JWTPayload {
  /** Subject == Clerk user id. */
  sub: string;
  /** Active organization id, when the session has an org selected. */
  org_id?: string;
  /** Authorized party (the frontend origin). */
  azp?: string;
}

/**
 * Verify a raw bearer token as a Clerk session JWT and derive the auth context.
 * Throws on any verification failure.
 */
export async function verifyClerkToken(token: string): Promise<AuthContext> {
  // `iss` alone only proves the token came from our Clerk INSTANCE — every
  // origin that instance authorizes shares it. `azp` is what pins the token to
  // our own frontend, so it is required, not optional: an unconfigured check
  // is an open door. Both accessors throw MissingEnvError when unset, which
  // fails closed and is the ONLY auth failure that gets logged (see below).
  const issuer = clerkIssuer();
  const allowedParties = clerkAuthorizedParties();

  const { payload } = await jwtVerify<ClerkClaims>(token, getJwks(issuer), {
    issuer,
  });

  // A MISSING azp must fail too: guarding on `payload.azp` being present would
  // let any token that simply omits the claim skip the check entirely.
  if (!payload.azp || !allowedParties.includes(payload.azp)) {
    throw new Error("Unrecognized or missing authorized party (azp)");
  }
  if (!payload.sub) {
    throw new Error("Token is missing a subject (sub) claim");
  }

  // Tenancy model: a tenant is the active Clerk organization. When the user has
  // no org selected, they act as their own single-user tenant.
  return {
    tenantId: payload.org_id ?? payload.sub,
    authType: "session",
    userId: payload.sub,
  };
}

/**
 * Log a session-verification failure ONLY when it was our own misconfiguration
 * (a missing env var). Bad/expired tokens are the normal case and are
 * deliberately not logged: a deploy missing a var would otherwise present as
 * "every session is invalid" with nothing in the logs, while logging bad tokens
 * would hand any anonymous caller a log-flooding lever. Both surface to the
 * caller as an indistinguishable 401 — a client must never learn which.
 */
function logIfMisconfigured(err: unknown): void {
  if (err instanceof MissingEnvError) {
    console.error("Session auth is misconfigured:", err.message);
  }
}

// --- API key verification ---------------------------------------------------

/**
 * Best-effort, per-instance throttle for `last_used_at` writes. Auth is on the
 * hot path, so we avoid a write on every request: a key is only written again
 * once its last recorded write is older than LAST_USED_THROTTLE_MS. Ephemeral
 * (resets when the instance recycles) — acceptable, since last-used is
 * advisory, not correctness-critical.
 */
const lastUsedWrites = new Map<string, number>();

function shouldWriteLastUsed(keyId: string): boolean {
  const now = Date.now();
  const prev = lastUsedWrites.get(keyId);
  if (prev !== undefined && now - prev < LAST_USED_THROTTLE_MS) return false;
  lastUsedWrites.set(keyId, now);
  return true;
}

interface ResolvedKey {
  keyId: string;
  tenantId: string;
  rateLimitPerMinute: number;
}

/**
 * Resolve an API key to its owning tenant. Lookup is by SHA-256 hash — constant
 * work, one read on the unique `key_hash` index, never a scan or a compare over
 * stored keys.
 *
 * There is deliberately NO cache in front of this. The Workers version kept a
 * KV entry with a TTL, which made revocation eventually-consistent: a revoked
 * key stayed valid until the cache entry was purged or expired. Nothing on
 * Vercel offers a *shared* cache this app already pays for, and a per-instance
 * one would be worse (unpurgeable from another instance). Since an API-key
 * request already touches Postgres for the rate-limit check, folding the key
 * lookup into the same database costs one extra indexed read and buys
 * **immediate** revocation.
 */
async function resolveApiKey(token: string): Promise<ResolvedKey> {
  const keyHash = await sha256Hex(token);
  const [row] = await getDb()
    .select({
      id: apiKeysTable.id,
      tenantId: apiKeysTable.tenantId,
      rateLimitPerMinute: apiKeysTable.rateLimitPerMinute,
      revokedAt: apiKeysTable.revokedAt,
    })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.keyHash, keyHash))
    .limit(1);

  if (!row || row.revokedAt !== null) throw invalidCredentials();
  return {
    keyId: row.id,
    tenantId: row.tenantId,
    rateLimitPerMinute: row.rateLimitPerMinute,
  };
}

/** Fire-and-forget `last_used_at` refresh (scheduled with `after`). */
async function touchLastUsed(keyId: string): Promise<void> {
  try {
    await getDb()
      .update(apiKeysTable)
      .set({ lastUsedAt: Date.now() })
      .where(eq(apiKeysTable.id, keyId));
  } catch (err) {
    // Advisory write — never surface to the request that already succeeded.
    console.error(`Failed to update last_used_at for key ${keyId}:`, err);
  }
}

// --- Credential extraction --------------------------------------------------

interface Credential {
  token: string | null;
  /** True when the token is (or claims to be) an API key rather than a JWT. */
  isApiKey: boolean;
}

/**
 * Pull a credential from the request: `X-API-Key` header, or an `Authorization:
 * Bearer …` value (classified as an API key by its `rag_live_` prefix, else a
 * session JWT).
 */
function extractCredential(req: Request): Credential {
  const apiKeyHeader = req.headers.get("X-API-Key");
  if (apiKeyHeader?.trim()) return { token: apiKeyHeader.trim(), isApiKey: true };

  const header = req.headers.get("Authorization") ?? "";
  const [scheme, value] = header.split(" ");
  if (scheme === "Bearer" && value) {
    return { token: value, isApiKey: looksLikeApiKey(value) };
  }
  return { token: null, isApiKey: false };
}

function invalidCredentials(): ApiError {
  return new ApiError(401, "Invalid or expired credentials");
}

// --- Rate-limit headers -----------------------------------------------------

/** IETF-draft RateLimit headers set on every API-key response. */
export function rateLimitHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(rl.limit),
    "RateLimit-Remaining": String(rl.remaining),
    "RateLimit-Reset": String(rl.resetSeconds),
  };
}

/**
 * The authenticated principal plus, for API-key traffic, the rate-limit
 * decision whose headers the response must carry.
 */
export interface Authenticated {
  auth: AuthContext;
  rateLimit: RateLimitResult | null;
}

// --- Entry points -----------------------------------------------------------

/**
 * Require a valid credential of EITHER type. API-key traffic is additionally
 * rate-limited (per key, before the handler runs, so a throttled request never
 * reaches embedding/retrieval/generation). A rejection throws a 429 ApiError
 * carrying Retry-After and the RateLimit-* headers.
 */
export async function requireAuth(req: Request): Promise<Authenticated> {
  const { token, isApiKey } = extractCredential(req);
  if (!token) throw new ApiError(401, "Missing credentials");

  if (!isApiKey) {
    try {
      return { auth: await verifyClerkToken(token), rateLimit: null };
    } catch (err) {
      logIfMisconfigured(err);
      throw invalidCredentials();
    }
  }

  const key = await resolveApiKey(token);

  // Rate-limit BEFORE any downstream work.
  const rl = await enforceRateLimit(
    key.keyId,
    key.rateLimitPerMinute,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rl.allowed) {
    // Record the 429 cheaply and OFF the critical path — no downstream work
    // (no embedding/retrieval/generation) is triggered for a throttled
    // request. Bucketed as a 'query' event: API-key traffic is overwhelmingly
    // query traffic and the dashboard surfaces rate-limits alongside query
    // outcomes. Collection attribution is skipped (unknown pre-dispatch).
    recordEvent(after, {
      tenantId: key.tenantId,
      eventType: "query",
      authType: "apikey",
      apiKeyId: key.keyId,
      status: "rate_limited",
      errorCode: "rate_limited",
    });
    const body: RateLimitErrorBody = {
      error: "Rate limit exceeded",
      retryAfter: rl.retryAfterSeconds,
      limit: rl.limit,
    };
    throw new ApiError(429, body.error, { retryAfter: body.retryAfter, limit: body.limit }, {
      "Retry-After": String(rl.retryAfterSeconds),
      ...rateLimitHeaders({ ...rl, remaining: 0 }),
    });
  }

  // Refresh last-used without adding latency (throttled, fire-and-forget).
  if (shouldWriteLastUsed(key.keyId)) {
    after(() => touchLastUsed(key.keyId));
  }

  return {
    auth: { tenantId: key.tenantId, authType: "apikey", keyId: key.keyId },
    rateLimit: rl,
  };
}

/**
 * Require a Clerk session specifically. Used for dashboard-only surfaces —
 * API-key management (a key must never mint/revoke keys) and usage analytics
 * (not part of the public API) — so presenting an API key here is a 401.
 */
export async function requireSession(req: Request): Promise<Authenticated> {
  const { token, isApiKey } = extractCredential(req);
  if (!token) throw new ApiError(401, "Missing bearer token");
  if (isApiKey) {
    throw new ApiError(
      401,
      "API keys cannot access this endpoint — use a dashboard session",
    );
  }

  try {
    return { auth: await verifyClerkToken(token), rateLimit: null };
  } catch (err) {
    logIfMisconfigured(err);
    throw new ApiError(401, "Invalid or expired token");
  }
}

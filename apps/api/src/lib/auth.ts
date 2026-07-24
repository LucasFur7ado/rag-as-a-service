import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { HonoRequest } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { eq } from "drizzle-orm";
import type { AuthContext, RateLimitErrorBody } from "@rag/shared";
import type { AppBindings, Env } from "../env";
import { getDb } from "../db";
import { apiKeys as apiKeysTable } from "../db/schema";
import {
  apiKeyCacheKey,
  looksLikeApiKey,
  sha256Hex,
  type ApiKeyCacheEntry,
} from "../services/apikeys";
import { enforceRateLimit, type RateLimitResult } from "../durable/ratelimiter";
import { recordEvent } from "../services/analytics";
import { LAST_USED_THROTTLE_MS, RATE_LIMIT_WINDOW_MS } from "../config";

/**
 * Unified authentication for the API (Feature 4).
 *
 * Two credential types resolve to the same {@link AuthContext}:
 * - a Clerk session JWT (dashboard), verified against Clerk's JWKS;
 * - an API key (`Authorization: Bearer rag_live_…` or `X-API-Key`), verified by
 *   SHA-256 hash lookup.
 *
 * `requireAuth` accepts EITHER (the public product surface); `requireSession`
 * accepts ONLY a session (API-key management must not be reachable with an API
 * key). API-key traffic is rate-limited before any downstream work.
 */

// --- Clerk session verification --------------------------------------------

// Cache one remote JWKS resolver per issuer. `createRemoteJWKSet` returns a
// function that additionally caches the fetched keys in-memory and refreshes
// them on rotation, so this map is effectively a per-isolate key cache.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string) {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    const jwksUrl = new URL("/.well-known/jwks.json", issuer);
    jwks = createRemoteJWKSet(jwksUrl);
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
export async function verifyClerkToken(
  token: string,
  env: Env,
): Promise<AuthContext> {
  if (!env.CLERK_ISSUER) {
    throw new Error("CLERK_ISSUER is not configured");
  }

  const jwks = getJwks(env.CLERK_ISSUER);
  const { payload } = await jwtVerify<ClerkClaims>(token, jwks, {
    issuer: env.CLERK_ISSUER,
  });

  if (env.CLERK_AUTHORIZED_PARTY && payload.azp) {
    const allowed = env.CLERK_AUTHORIZED_PARTY.split(",").map((p) => p.trim());
    if (!allowed.includes(payload.azp)) {
      throw new Error("Unrecognized authorized party (azp)");
    }
  }

  if (!payload.sub) {
    throw new Error("Token is missing a subject (sub) claim");
  }

  // Tenancy model: a tenant is the active Clerk organization. When the user has
  // no org selected, they act as their own single-user tenant.
  const tenantId = payload.org_id ?? payload.sub;

  return { tenantId, authType: "session", userId: payload.sub };
}

// --- API key verification ---------------------------------------------------

/**
 * Best-effort, per-isolate throttle for `last_used_at` writes. Auth is on the
 * hot path, so we avoid a D1 write on every request: a key is only written
 * again once its last recorded write is older than LAST_USED_THROTTLE_MS.
 * Ephemeral (resets on isolate recycle) — acceptable, since last-used is
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

/**
 * Resolve an API key to its cache entry. Lookup is by SHA-256 hash (constant
 * work — one indexed read), never by scanning stored keys.
 *
 * Fast path: KV (read-optimized). On a KV miss — cold cache or eventual
 * consistency after a create — fall back to D1 (the source of truth) and
 * repopulate KV. A missing or revoked key throws 401.
 */
async function resolveApiKey(
  token: string,
  env: Env,
): Promise<ApiKeyCacheEntry> {
  const keyHash = await sha256Hex(token);
  const cacheKey = apiKeyCacheKey(keyHash);

  const cached = await env.KV.get<ApiKeyCacheEntry>(cacheKey, "json");
  if (cached) {
    if (cached.revoked) throw invalidCredentials();
    return cached;
  }

  const db = getDb(env);
  const [row] = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.keyHash, keyHash))
    .limit(1);
  if (!row || row.revokedAt !== null) throw invalidCredentials();

  const entry: ApiKeyCacheEntry = {
    keyId: row.id,
    tenantId: row.tenantId,
    revoked: false,
    rateLimitPerMinute: row.rateLimitPerMinute,
  };
  // Repopulate the cache for subsequent requests (best-effort).
  await env.KV.put(cacheKey, JSON.stringify(entry));
  return entry;
}

/** Fire-and-forget `last_used_at` refresh (called via ctx.waitUntil). */
async function touchLastUsed(env: Env, keyId: string): Promise<void> {
  try {
    await getDb(env)
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
function extractCredential(req: HonoRequest): Credential {
  const apiKeyHeader = req.header("X-API-Key");
  if (apiKeyHeader?.trim()) return { token: apiKeyHeader.trim(), isApiKey: true };

  const header = req.header("Authorization") ?? "";
  const [scheme, value] = header.split(" ");
  if (scheme === "Bearer" && value) {
    return { token: value, isApiKey: looksLikeApiKey(value) };
  }
  return { token: null, isApiKey: false };
}

function invalidCredentials(): HTTPException {
  return new HTTPException(401, { message: "Invalid or expired credentials" });
}

// --- Rate-limit headers -----------------------------------------------------

/** Attach standard RateLimit-* headers (IETF draft) to a response's headers. */
function setRateLimitHeaders(headers: Headers, rl: RateLimitResult): void {
  headers.set("RateLimit-Limit", String(rl.limit));
  headers.set("RateLimit-Remaining", String(rl.remaining));
  headers.set("RateLimit-Reset", String(rl.resetSeconds));
}

// --- Middleware -------------------------------------------------------------

/**
 * Require a valid credential of EITHER type. API-key traffic is additionally
 * rate-limited (per key, before route handlers run, so a throttled request
 * never reaches embedding/retrieval/generation). Successful API-key responses
 * carry RateLimit-* headers; a rejection returns 429 + Retry-After.
 */
export const requireAuth = createMiddleware<AppBindings>(async (c, next) => {
  const { token, isApiKey } = extractCredential(c.req);
  if (!token) {
    throw new HTTPException(401, { message: "Missing credentials" });
  }

  if (!isApiKey) {
    let auth: AuthContext;
    try {
      auth = await verifyClerkToken(token, c.env);
    } catch {
      throw invalidCredentials();
    }
    c.set("auth", auth);
    await next();
    return;
  }

  const entry = await resolveApiKey(token, c.env);

  // Rate-limit BEFORE any downstream work.
  const rl = await enforceRateLimit(
    c.env.RATE_LIMITER,
    entry.keyId,
    entry.rateLimitPerMinute,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rl.allowed) {
    // Record the 429 cheaply and OFF the critical path — no downstream work
    // (no embedding/retrieval/generation) is triggered for a throttled
    // request. Bucketed as a 'query' event: API-key traffic is overwhelmingly
    // query traffic and the dashboard surfaces rate-limits alongside query
    // outcomes. Collection attribution is skipped (unknown pre-dispatch).
    recordEvent(c.env, (p) => c.executionCtx.waitUntil(p), {
      tenantId: entry.tenantId,
      eventType: "query",
      authType: "apikey",
      apiKeyId: entry.keyId,
      status: "rate_limited",
      errorCode: "rate_limited",
    });
    const body: RateLimitErrorBody = {
      error: "Rate limit exceeded",
      retryAfter: rl.retryAfterSeconds,
      limit: rl.limit,
    };
    return c.json(body, 429, {
      "Retry-After": String(rl.retryAfterSeconds),
      "RateLimit-Limit": String(rl.limit),
      "RateLimit-Remaining": "0",
      "RateLimit-Reset": String(rl.resetSeconds),
    });
  }

  // Refresh last-used without adding latency (throttled, fire-and-forget).
  if (shouldWriteLastUsed(entry.keyId)) {
    c.executionCtx.waitUntil(touchLastUsed(c.env, entry.keyId));
  }

  c.set("auth", {
    tenantId: entry.tenantId,
    authType: "apikey",
    keyId: entry.keyId,
  });
  await next();
  setRateLimitHeaders(c.res.headers, rl);
});

/**
 * Require a Clerk session specifically. Used for dashboard-only surfaces —
 * API-key management (a key must never mint/revoke keys) and usage analytics
 * (not part of the public API) — so presenting an API key here is a 401.
 */
export const requireSession = createMiddleware<AppBindings>(async (c, next) => {
  const { token, isApiKey } = extractCredential(c.req);
  if (!token) {
    throw new HTTPException(401, { message: "Missing bearer token" });
  }
  if (isApiKey) {
    throw new HTTPException(401, {
      message:
        "API keys cannot access this endpoint — use a dashboard session",
    });
  }

  let auth: AuthContext;
  try {
    auth = await verifyClerkToken(token, c.env);
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired token" });
  }

  c.set("auth", auth);
  await next();
});

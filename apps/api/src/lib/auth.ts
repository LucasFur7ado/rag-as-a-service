import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AuthContext } from "@rag/shared";
import type { AppBindings, Env } from "../env";

/**
 * Clerk JWT verification.
 *
 * Clerk issues short-lived session JWTs signed with RS256. We verify them by
 * validating the signature against Clerk's JWKS (discovered from the issuer's
 * OIDC endpoint) and checking the issuer claim. The JWKS is cached per-issuer
 * so we don't refetch keys on every request.
 */

// Cache one remote JWKS resolver per issuer. `createRemoteJWKSet` returns a
// function that additionally caches the fetched keys in-memory and refreshes
// them on rotation, so this map is effectively a per-isolate key cache.
const jwksCache = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

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
 * Verify a raw bearer token and derive the auth context.
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

  return { userId: payload.sub, tenantId };
}

/**
 * Hono middleware: require a valid Clerk JWT.
 * - 401 when the Authorization header is missing/malformed or the token is invalid.
 * - On success, attaches `{ userId, tenantId }` to the context as `auth`.
 */
export const requireAuth = createMiddleware<AppBindings>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new HTTPException(401, { message: "Missing bearer token" });
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

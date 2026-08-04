import "server-only";

import { corsAllowedOrigins } from "../env";
import { ApiError } from "./errors";
import { MissingEnvError } from "../env";

/**
 * Route-handler plumbing: uniform error bodies, CORS, and JSON helpers.
 *
 * The contract is deliberately identical to the Hono/Workers version it
 * replaces — `{ "error": "<message>" }` with the thrown status — so existing
 * clients, the OpenAPI spec, and the docs stay accurate.
 */

/** JSON response with optional extra headers. */
export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, { status, headers });
}

/** 204 with no body. */
export function noContent(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 204, headers });
}

/**
 * Wrap a route handler so thrown errors become the documented JSON bodies.
 *
 * - {@link ApiError} → its own status, message, and any extra body/headers.
 * - {@link MissingEnvError} → 500. This is an operator problem (a deploy
 *   missing a variable), so it is logged and reported with its message: it can
 *   only be triggered by a misconfigured deployment, never by request content,
 *   so it leaks nothing to an attacker that they could not already infer.
 * - anything else → logged, and an opaque 500.
 */
export function handler<A extends unknown[]>(
  fn: (req: Request, ...args: A) => Promise<Response>,
): (req: Request, ...args: A) => Promise<Response> {
  return async (req, ...args) => {
    try {
      return withCors(req, await fn(req, ...args));
    } catch (err) {
      if (err instanceof ApiError) {
        return withCors(
          req,
          json({ error: err.message, ...err.body }, err.status, err.headers ?? {}),
        );
      }
      if (err instanceof MissingEnvError) {
        console.error("Configuration error:", err.message);
        return withCors(req, json({ error: err.message }, 500));
      }
      console.error("Unhandled error:", err);
      return withCors(req, json({ error: "Internal Server Error" }, 500));
    }
  };
}

// --- CORS -------------------------------------------------------------------
// The dashboard is same-origin now, so CORS only matters for programmatic
// API-key callers running in a browser on another origin. It is therefore
// opt-in via API_CORS_ORIGINS and closed by default; server-to-server callers
// (curl, backends) are unaffected either way.

const ALLOWED_HEADERS = "Authorization, Content-Type, X-API-Key";
const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";

function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get("Origin");
  if (!origin) return null;
  return corsAllowedOrigins().includes(origin) ? origin : null;
}

/** Attach CORS headers when the request came from an allow-listed origin. */
function withCors(req: Request, res: Response): Response {
  const origin = allowedOrigin(req);
  if (!origin) return res;
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Expose-Headers", "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/** Shared CORS preflight response; export as `OPTIONS` from a route. */
export function preflight(req: Request): Response {
  const origin = allowedOrigin(req);
  if (!origin) return new Response(null, { status: 204 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": ALLOWED_HEADERS,
      "Access-Control-Allow-Methods": ALLOWED_METHODS,
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

/** Parse a JSON body, rejecting malformed input with the documented 400. */
export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
}

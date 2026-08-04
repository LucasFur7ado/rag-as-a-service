/**
 * Error taxonomy shared by the routes and the ingestion pipeline.
 *
 * `PermanentError` marks a failure that will not succeed on retry
 * (unparseable file, 4xx from a provider, config mismatch). Everything else
 * (network, 429, 5xx) is thrown as a plain `Error` and is considered
 * transient — `withRetries` in services/ingest.ts retries those and fails
 * fast on a PermanentError.
 */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

/**
 * An error carrying the HTTP status a route handler should return.
 *
 * Route handlers throw this and the `handler()` wrapper (lib/http.ts) turns it
 * into `{ error: message }` with the given status — the same contract the Hono
 * `HTTPException` gave the Workers version, so response bodies are unchanged.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Extra top-level fields to merge into the JSON body (e.g. retryAfter). */
    readonly body?: Record<string, unknown>,
    /** Extra response headers (e.g. Retry-After, RateLimit-*). */
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string) => new ApiError(400, message);
export const unauthorized = (message: string) => new ApiError(401, message);
export const notFound = (message: string) => new ApiError(404, message);
export const conflict = (message: string) => new ApiError(409, message);

/**
 * Error taxonomy for the ingestion pipeline.
 *
 * Services and extractors throw `PermanentError` for failures that will not
 * succeed on retry (unparseable file, 4xx from a provider, config mismatch).
 * Everything else (network, 429, 5xx) is thrown as a plain `Error` and is
 * considered transient. The ingestion Workflow maps `PermanentError` to
 * Cloudflare's `NonRetryableError` so the step fails fast instead of burning
 * its retry budget.
 */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

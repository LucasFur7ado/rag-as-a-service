import { EVAL_MAX_RETRIES, EVAL_RETRY_BASE_MS } from "../config";
import { PermanentError } from "../../src/server/lib/errors";

/**
 * Retry with exponential backoff, using the app's own error taxonomy.
 *
 * `PermanentError` means a 4xx that is not 429 — a bad token, an unknown model,
 * a dimension mismatch — and propagates on the first attempt. Everything else
 * (429, 5xx, network) is transient and is retried. Sharing the taxonomy with
 * services/ingest.ts is the point: if the harness treated a provider error
 * differently from ingestion, a config that fails in production could still
 * post good evaluation numbers.
 *
 * The retry budget is more generous than ingestion's, because a run has no
 * request timeout to respect and re-running a 20-minute experiment to get past
 * one 429 wastes far more than the wait does.
 */
export async function withRetries<T>(
  label: string,
  fn: () => Promise<T>,
  maxRetries = EVAL_MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PermanentError) throw err;
      lastError = err;
      if (attempt === maxRetries) break;
      const delay = EVAL_RETRY_BASE_MS * 2 ** attempt;
      console.warn(
        `  ! ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

export const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

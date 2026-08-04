import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "../db";

/**
 * Per-key rate limiter, backed by Postgres.
 *
 * **Why not a counter in a cache.** The Cloudflare version used a Durable
 * Object, whose single-threaded-per-instance execution gave true atomic
 * increments. There is no equivalent primitive on Vercel: functions are
 * stateless and scale horizontally, so any in-process counter is per-instance
 * and trivially bypassed by landing on a different one. The limiter has to
 * live in shared storage, and the only shared store this app already has is
 * Postgres — which is also the only one that can make the check *atomic*.
 *
 * **How atomicity is preserved.** Neon's HTTP driver has no interactive
 * transactions, so a read-then-write would race: two concurrent requests could
 * both read `n = limit - 1` and both admit. Instead the whole check runs as one
 * statement that first takes a transaction-scoped advisory lock keyed on the
 * API key. Every request for a given key therefore serializes on that lock,
 * exactly as it did on one DO instance, while different keys never contend.
 * The lock is released when the implicit transaction ends.
 *
 * **Algorithm: sliding-window log.** `rate_limits.hits` holds the timestamps of
 * allowed hits still inside the trailing window. A naive *fixed* window lets a
 * caller fire a full quota at the end of one window and again at the start of
 * the next (~2x burst at the boundary); the window here moves continuously with
 * `now`, so the limit holds across every 60s span. Rejected requests are not
 * recorded, so being throttled never extends the penalty.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** The limit that applied (requests per window). */
  limit: number;
  /** Requests remaining in the current window after this one. */
  remaining: number;
  /** Seconds until the window frees capacity (for RateLimit-Reset). */
  resetSeconds: number;
  /** Seconds the caller should wait before retrying (0 when allowed). */
  retryAfterSeconds: number;
}

/**
 * Shape returned by the upsert below. Values may arrive as strings: Postgres
 * `bigint` is handed back as text by the driver to preserve precision.
 */
interface LimiterRow extends Record<string, unknown> {
  /** Hits inside the window BEFORE this request was considered. */
  before: number | string;
  /** Oldest in-window hit after the update, or null when the window is empty. */
  oldest: string | number | null;
}

/**
 * Enforce the per-key limit. One round trip; safe to call on every request.
 *
 * The statement is a single CTE chain so that ordering is guaranteed:
 * `locked` takes the advisory lock, `windowed` depends on `locked` (so the
 * read cannot happen before the lock is held), and the upsert depends on
 * `windowed`.
 */
export async function enforceRateLimit(
  keyId: string,
  limitPerMinute: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const cutoff = now - windowMs;

  const result = await getDb().execute<LimiterRow>(sql`
    WITH locked AS (
      -- Serializes every concurrent request for THIS key; released with the
      -- implicit transaction. Different keys hash to different lock ids.
      SELECT pg_advisory_xact_lock(hashtextextended(${`ratelimit:${keyId}`}, 0)) AS ok
    ),
    windowed AS (
      SELECT
        COALESCE(
          (
            SELECT array_agg(t ORDER BY t)
            FROM unnest(COALESCE(rl.hits, '{}'::bigint[])) AS t
            WHERE t > ${cutoff}
          ),
          '{}'::bigint[]
        ) AS kept
      FROM locked
      LEFT JOIN rate_limits rl ON rl.key_id = ${keyId}
    ),
    upserted AS (
      INSERT INTO rate_limits (key_id, hits, updated_at)
      SELECT
        ${keyId},
        CASE
          WHEN cardinality(kept) >= ${limitPerMinute} THEN kept
          ELSE kept || ${now}::bigint
        END,
        ${now}
      FROM windowed
      ON CONFLICT (key_id) DO UPDATE
        SET hits = EXCLUDED.hits, updated_at = EXCLUDED.updated_at
      RETURNING hits
    )
    SELECT
      cardinality(windowed.kept)::int AS before,
      (SELECT hits[1] FROM upserted) AS oldest
    FROM windowed
  `);

  const row = firstRow(result);
  const before = Number(row?.before ?? 0);
  const oldest = row?.oldest != null ? Number(row.oldest) : null;
  const allowed = before < limitPerMinute;

  // Capacity frees when the oldest in-window hit ages out.
  const resetSeconds = oldest
    ? Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
    : Math.ceil(windowMs / 1000);

  return {
    allowed,
    limit: limitPerMinute,
    remaining: allowed ? Math.max(0, limitPerMinute - (before + 1)) : 0,
    resetSeconds,
    retryAfterSeconds: allowed ? 0 : resetSeconds,
  };
}

/**
 * Drop rate-limit rows that have been idle longer than `ttlMs`. Pure
 * housekeeping (an absent row and an empty window are the same thing to
 * {@link enforceRateLimit}); called from the retention cron.
 */
export async function pruneRateLimits(ttlMs: number): Promise<{ cutoff: number }> {
  const cutoff = Date.now() - ttlMs;
  await getDb().execute(
    sql`DELETE FROM rate_limits WHERE updated_at < ${cutoff}`,
  );
  return { cutoff };
}

/**
 * Normalize the driver's result shape. `drizzle-orm/neon-http` returns
 * `{ rows }` for `execute`, but the same code path is exercised by tests with
 * a plain array, so handle both.
 */
function firstRow(result: unknown): LimiterRow | undefined {
  if (Array.isArray(result)) return result[0] as LimiterRow | undefined;
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows[0] as LimiterRow | undefined) : undefined;
}

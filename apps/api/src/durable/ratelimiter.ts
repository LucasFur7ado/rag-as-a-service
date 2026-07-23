import { DurableObject } from "cloudflare:workers";

/**
 * Per-key rate limiter (Feature 4), backed by a Durable Object.
 *
 * Why a Durable Object (and not KV): KV is eventually consistent with per-key
 * write limits, so a counter kept there would be inaccurate and bypassable
 * across concurrent requests and colos. A DO is single-threaded per instance,
 * giving true atomic increments. Why not Cloudflare's native rate-limiting
 * binding: its limit/period are fixed in wrangler config and it returns only
 * `{ success }`, so it can't do per-key custom limits (`rate_limit_per_minute`)
 * or expose the exact remaining/reset needed for RateLimit-* headers.
 *
 * One DO instance per API key (routed by `getByName("key:{keyId}")`), so each
 * key's counter is isolated and contention is per-key, never global.
 *
 * Algorithm: sliding-window log — we keep the timestamps of allowed hits within
 * the trailing window. Unlike a fixed window (which lets a caller fire the full
 * quota at the end of one window and again at the start of the next — ~2x burst
 * at the boundary), the window here moves continuously with `now`, so the limit
 * holds across every 60s span. The log is naturally bounded by the limit (once
 * full, further requests are rejected without being recorded).
 *
 * State is in-memory only: a rate-limit counter doesn't need durability — if
 * the DO is evicted the window simply resets, which is at worst momentarily
 * lenient, never incorrect. This keeps the hot path free of storage writes.
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

export class RateLimiter extends DurableObject {
  /** Timestamps (epoch ms) of allowed hits still inside the window. */
  private hits: number[] = [];

  /**
   * Record an attempt against `limit` requests per `windowMs` and report the
   * decision. Called once per request, before any expensive work.
   */
  check(limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const cutoff = now - windowMs;

    // Drop hits that have aged out of the trailing window.
    if (this.hits.length > 0 && this.hits[0] <= cutoff) {
      this.hits = this.hits.filter((t) => t > cutoff);
    }

    if (this.hits.length >= limit) {
      // Over the limit: capacity frees when the oldest in-window hit expires.
      const resetSeconds = Math.max(1, Math.ceil((this.hits[0] + windowMs - now) / 1000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds,
        retryAfterSeconds: resetSeconds,
      };
    }

    this.hits.push(now);
    const resetSeconds = Math.max(1, Math.ceil((this.hits[0] + windowMs - now) / 1000));
    return {
      allowed: true,
      limit,
      remaining: limit - this.hits.length,
      resetSeconds,
      retryAfterSeconds: 0,
    };
  }
}

/**
 * Enforce the per-key limit by routing to the key's own DO instance. Kept as a
 * thin helper so route/middleware code depends on this, not the DO wiring.
 */
export async function enforceRateLimit(
  namespace: DurableObjectNamespace<RateLimiter>,
  keyId: string,
  limitPerMinute: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const stub = namespace.getByName(`key:${keyId}`);
  return stub.check(limitPerMinute, windowMs);
}

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lightweight client-side cache + request dedupe for analytics widgets
 * (Feature 5). Keyed by a stable request signature (endpoint + range +
 * filters), so:
 * - switching the date range / collection back and forth reuses a cached
 *   result instead of refetching an identical window;
 * - two widgets requesting the same key in the same tick share one in-flight
 *   request.
 *
 * The cache is intentionally simple (module-level Maps). A manual refresh
 * clears it via {@link clearAnalyticsCache}; filters change the key, so they
 * naturally miss the cache the first time and hit it thereafter.
 */

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

/** Drop all cached analytics results (used by the dashboard Refresh button). */
export function clearAnalyticsCache(): void {
  cache.clear();
  inflight.clear();
}

async function cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fetcher()
    .then((value) => {
      cache.set(key, value);
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, promise);
  return promise;
}

export interface AnalyticsResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Internal: the last settled result, tagged with the key it belongs to. */
interface Settled<T> {
  key: string | null;
  data: T | null;
  error: string | null;
}

/**
 * Fetch one analytics resource with its own loading/error state, so a slow
 * widget never blocks the others. `key` fully identifies the request (include
 * every filter that affects the result); pass `null` to stay idle.
 *
 * `fetcher` is read through a ref (updated in an effect) so only `key` drives
 * refetching. Loading is *derived* — it's true whenever the last settled
 * result doesn't belong to the current key — which avoids a synchronous
 * setState in the effect (and hides stale data during a key change).
 */
export function useAnalyticsResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): AnalyticsResourceState<T> {
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [settled, setSettled] = useState<Settled<T>>({
    key: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    cachedFetch(key, () => fetcherRef.current())
      .then((data) => {
        if (!cancelled) setSettled({ key, data: data as T, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setSettled({
            key,
            data: null,
            error: err instanceof Error ? err.message : "Failed to load",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = settled.key === key;
  return {
    data: current ? settled.data : null,
    error: current ? settled.error : null,
    loading: key !== null && !current,
  };
}

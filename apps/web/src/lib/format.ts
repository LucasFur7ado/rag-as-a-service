/**
 * Number/latency/currency/percent formatting for the analytics dashboard.
 * Centralized so every widget renders values identically (compact counts,
 * ms↔s latency, USD cost, one-decimal percentages).
 */

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const plain = new Intl.NumberFormat("en-US");

/** Large counts in compact notation (e.g. 12.3K, 1.2M); small counts in full. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.abs(n) >= 10_000 ? compact.format(n) : plain.format(n);
}

/** Latency in ms, promoted to seconds past 1000ms (e.g. 850 ms, 1.2 s). */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/**
 * USD cost. Sub-cent values keep more precision (these are rough per-query
 * estimates), larger totals round to cents.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

/** Fraction in [0,1] → one-decimal percentage (e.g. 0.9421 → "94.2%"). */
export function formatPercent(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Bytes → human units (KB/MB/GB). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/** Short absolute timestamp for table rows / tooltips. */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Bucket label for time-series axes, granularity-aware. */
export function formatBucket(ms: number, granularity: "hour" | "day"): string {
  const d = new Date(ms);
  return granularity === "hour"
    ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" })
    : d.toLocaleString(undefined, { month: "short", day: "numeric" });
}

export interface Delta {
  /** Signed relative change vs. the previous period, or null when undefined. */
  ratio: number | null;
  direction: "up" | "down" | "flat";
}

/**
 * Relative change between a value and its previous-period value. Returns a
 * null ratio when the previous period was zero (no meaningful percentage) but
 * still reports direction from the raw movement.
 */
export function computeDelta(value: number, previous: number): Delta {
  const direction =
    value > previous ? "up" : value < previous ? "down" : "flat";
  if (previous === 0) return { ratio: null, direction };
  return { ratio: (value - previous) / Math.abs(previous), direction };
}

/** Format a delta ratio as a signed percentage (e.g. +12.4%, −3.1%). */
export function formatDelta(ratio: number | null): string {
  if (ratio == null) return "—";
  const sign = ratio > 0 ? "+" : ratio < 0 ? "−" : "";
  return `${sign}${Math.abs(ratio * 100).toFixed(1)}%`;
}

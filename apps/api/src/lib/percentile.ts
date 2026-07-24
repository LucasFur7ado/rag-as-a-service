/**
 * Percentile math for the analytics aggregations — the single source of truth
 * for the rank formula used both in JS (tests, any in-memory use) and in the
 * SQL percentile queries (via {@link percentileRankSql}).
 *
 * We use the *nearest-rank* method (no interpolation): for `n` ascending
 * values the p-th percentile is the value at 0-based index
 * `round(p * (n - 1))`. It is simple, deterministic, needs no interpolation,
 * and — crucially — maps to a single `ROW_NUMBER()` filter so percentiles can
 * be computed in SQL without pulling raw rows into JS.
 */

/**
 * 0-based index into `n` ascending-ordered values for percentile `p` (0..1).
 * Clamped to `[0, n-1]`. This is THE formula; everything else derives from it.
 */
export function nearestRankIndex(n: number, p: number): number {
  if (n <= 0) return 0;
  const clampedP = Math.min(Math.max(p, 0), 1);
  const idx = Math.round(clampedP * (n - 1));
  return Math.min(Math.max(idx, 0), n - 1);
}

/**
 * Nearest-rank percentile of `values` (any order; sorted internally). Returns
 * null for an empty input. `p` is a fraction in [0, 1] (e.g. 0.95 for p95).
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[nearestRankIndex(sorted.length, p)];
}

/**
 * SQLite expression for the *1-based* nearest-rank row number, given a SQL
 * expression that evaluates to the partition row count (`cntExpr`). Pair it
 * with a `ROW_NUMBER() OVER (... ORDER BY <value>)` column and filter
 * `rn = <this>` to select the percentile value — no raw rows leave SQLite.
 *
 * Mirrors {@link nearestRankIndex} + 1 (SQL ROW_NUMBER is 1-based). SQLite's
 * scalar `min`/`max` clamp defensively; `round()` matches JS `Math.round`
 * for the non-negative arguments here.
 */
export function percentileRankSql(cntExpr: string, p: number): string {
  const clampedP = Math.min(Math.max(p, 0), 1);
  return `CAST(min(max(round(${clampedP} * (${cntExpr} - 1)), 0), ${cntExpr} - 1) AS INTEGER) + 1`;
}

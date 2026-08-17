// Relative rather than the `@/` alias: these modules are loaded by plain tsx
// scripts as well as by vitest, and a relative path needs no resolver config.
import { percentile } from "../../src/server/lib/percentile";

/**
 * Retrieval metric math.
 *
 * Every function here is pure and deterministic, which is why these — and only
 * these — parts of the harness are covered by the vitest suite (metrics.test.ts)
 * that runs in CI with no secrets. A wrong metric does not fail loudly; it
 * reports a plausible number and quietly points the next optimisation in the
 * wrong direction, so the fixtures in that file are the real safety net.
 *
 * The median helper is `percentile()` from src/server/lib — the same
 * nearest-rank implementation the analytics dashboard uses, rather than a
 * second definition of "median" that could disagree with it.
 */

/** One query's ranked outcome, as judged by the span-overlap rule. */
export interface QueryJudgement {
  /**
   * Graded relevance of each retrieved result, best-ranked first. 0 means
   * irrelevant; higher is better.
   */
  gains: number[];
  /**
   * Gains of EVERY relevant chunk that exists in the index for this query, in
   * any order — including those retrieval never returned.
   *
   * This is what makes recall true recall rather than a hit rate. It is
   * knowable only because the harness chunks the corpus itself and can ask
   * which chunks overlap the golden span, whether or not they were retrieved.
   */
  idealGains: number[];
}

// --- Per-query metrics ------------------------------------------------------

/** Number of relevant results in the top `k`. */
function relevantInTopK(gains: number[], k: number): number {
  return gains.slice(0, k).filter((g) => g > 0).length;
}

/**
 * Did ANY relevant chunk appear in the top `k`? 1 or 0.
 *
 * Distinct from recall@k, which the two are often conflated: hit rate asks
 * whether the user could have been answered at all, recall asks how much of the
 * available evidence was surfaced. A config can hold hit rate flat while
 * halving recall, and only the second shows up as thinner context.
 */
export function hitRateAtK(gains: number[], k: number): number {
  return relevantInTopK(gains, k) > 0 ? 1 : 0;
}

/** Fraction of the top `k` slots filled by relevant chunks. */
export function precisionAtK(gains: number[], k: number): number {
  if (k <= 0) return 0;
  // Divided by k, not by the number of results returned: a config that returns
  // 3 results for a topK of 10 has left 7 slots unfilled, and precision should
  // reflect that rather than flatter it.
  return relevantInTopK(gains, k) / k;
}

/** Fraction of all relevant chunks that appear in the top `k`. */
export function recallAtK(judgement: QueryJudgement, k: number): number | null {
  const total = judgement.idealGains.length;
  // No relevant chunk exists in the index at all — usually a golden span that
  // points outside its document. Excluded from the average rather than counted
  // as 0, which would blame retrieval for a dataset bug.
  if (total === 0) return null;
  return relevantInTopK(judgement.gains, k) / total;
}

/** 1-based rank of the first relevant result; null if there is none. */
export function firstRelevantRank(gains: number[]): number | null {
  const index = gains.findIndex((g) => g > 0);
  return index === -1 ? null : index + 1;
}

/** Reciprocal of the first relevant rank; 0 when nothing relevant was found. */
export function reciprocalRank(gains: number[]): number {
  const rank = firstRelevantRank(gains);
  return rank === null ? 0 : 1 / rank;
}

/** Discounted cumulative gain over the top `k`. */
export function dcgAtK(gains: number[], k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, gains.length); i++) {
    // log2(i + 2) because ranks are 1-based: rank 1 gets a discount of log2(2)=1.
    dcg += gains[i] / Math.log2(i + 2);
  }
  return dcg;
}

/**
 * NDCG@k against the best ranking the index could possibly have produced.
 *
 * The ideal is built from `idealGains` — every relevant chunk that exists,
 * sorted best-first — not from a re-sort of what was retrieved. Normalising
 * against the retrieved set would score a run that found one of five relevant
 * chunks, and ranked it first, as a perfect 1.0.
 *
 * Returns null when nothing relevant exists, matching {@link recallAtK}.
 */
export function ndcgAtK(judgement: QueryJudgement, k: number): number | null {
  const ideal = [...judgement.idealGains].sort((a, b) => b - a);
  const idcg = dcgAtK(ideal, k);
  if (idcg === 0) return null;
  return dcgAtK(judgement.gains, k) / idcg;
}

// --- Aggregation ------------------------------------------------------------

/** Metrics at one cutoff. */
export interface MetricsAtK {
  hitRate: number;
  precision: number;
  recall: number | null;
  ndcg: number | null;
}

/** A full metric set over a group of queries. */
export interface MetricSet {
  /** Queries in this group. */
  queries: number;
  /** Keyed by cutoff k. */
  atK: Record<number, MetricsAtK>;
  mrr: number;
  /** Over queries that found something relevant; null if none did. */
  meanFirstRank: number | null;
  medianFirstRank: number | null;
  /** Queries with no relevant chunk anywhere in the retrieved list. */
  completeMisses: number;
  /** Queries whose golden span matched no chunk in the index (dataset bug). */
  unjudgeable: number;
}

/** Mean of the non-null values; null when there are none. */
function meanOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

/** Aggregate per-query judgements into one metric set. */
export function aggregate(
  judgements: QueryJudgement[],
  kValues: readonly number[],
): MetricSet {
  const atK: Record<number, MetricsAtK> = {};
  for (const k of kValues) {
    atK[k] = {
      hitRate: meanOf(judgements.map((j) => hitRateAtK(j.gains, k))) ?? 0,
      precision: meanOf(judgements.map((j) => precisionAtK(j.gains, k))) ?? 0,
      recall: meanOf(judgements.map((j) => recallAtK(j, k))),
      ndcg: meanOf(judgements.map((j) => ndcgAtK(j, k))),
    };
  }

  const firstRanks = judgements
    .map((j) => firstRelevantRank(j.gains))
    .filter((r): r is number => r !== null);

  return {
    queries: judgements.length,
    atK,
    mrr: meanOf(judgements.map((j) => reciprocalRank(j.gains))) ?? 0,
    meanFirstRank: meanOf(firstRanks),
    medianFirstRank: percentile(firstRanks, 0.5),
    completeMisses: judgements.filter((j) => firstRelevantRank(j.gains) === null).length,
    unjudgeable: judgements.filter((j) => j.idealGains.length === 0).length,
  };
}

/**
 * Group items by a key, keeping items whose key is undefined out of the result
 * rather than bucketing them under "undefined".
 */
export function groupBy<T>(
  items: T[],
  key: (item: T) => string | string[] | undefined,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const raw = key(item);
    if (raw === undefined) continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      const bucket = groups.get(value);
      if (bucket) bucket.push(item);
      else groups.set(value, [item]);
    }
  }
  return groups;
}

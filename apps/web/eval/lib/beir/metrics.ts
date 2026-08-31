import type { QueryJudgement } from "../metrics";

/**
 * The one metric BEIR reports that the shared metric module does not: MAP.
 *
 * It lives here rather than in `lib/metrics.ts` deliberately. MAP is a
 * convention of this benchmark, not of the harness, and adding it to the shared
 * `MetricSet` would change the shape of every `metrics.json` the span-based
 * harness has already written. Everything else BEIR reports — hit rate,
 * precision, recall, NDCG, MRR — comes from `aggregate()` unchanged, because
 * those functions take gains and know nothing about whether a gain came from a
 * span overlap or a qrel grade.
 *
 * Pure and deterministic, and unit-tested for the same reason the rest of the
 * metric math is.
 */

/**
 * Average precision over the top `k` of one ranking.
 *
 * Precision is sampled at each rank holding a relevant result and averaged, so
 * a ranking that puts its relevant documents early scores higher than one that
 * finds the same documents late — which is the whole point of MAP over plain
 * recall.
 *
 * **Normalization:** the sum is divided by the total number of relevant
 * documents the query has, NOT by `min(k, relevant)`. That matches trec_eval's
 * `map_cut` and it is why MAP@10 on a dataset like NFCorpus — which averages
 * ~38 relevant documents per query — is bounded far below 1 no matter how good
 * retrieval is. Reported here rather than left implicit, because the two
 * conventions differ by a large constant factor and a number quoted without one
 * is not interpretable.
 *
 * Graded qrels are treated as binary for this metric, again matching trec_eval:
 * any positive grade counts once. NDCG is where the grades do their work.
 *
 * Returns null when the query has no relevant documents at all, matching
 * `recallAtK` / `ndcgAtK` so such queries are excluded from an average rather
 * than counted as zero.
 */
export function averagePrecisionAtK(judgement: QueryJudgement, k: number): number | null {
  const totalRelevant = judgement.idealGains.filter((gain) => gain > 0).length;
  if (totalRelevant === 0) return null;

  let found = 0;
  let sum = 0;
  for (let i = 0; i < Math.min(k, judgement.gains.length); i++) {
    if (judgement.gains[i] > 0) {
      found++;
      sum += found / (i + 1);
    }
  }
  return sum / totalRelevant;
}

/** MAP@k across a set of queries; null when none of them is judgeable. */
export function meanAveragePrecisionAtK(
  judgements: readonly QueryJudgement[],
  k: number,
): number | null {
  const scores = judgements
    .map((judgement) => averagePrecisionAtK(judgement, k))
    .filter((score): score is number => score !== null);
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

/** MAP at each cutoff, keyed by k — the shape the report and metrics.json use. */
export function mapAtEachK(
  judgements: readonly QueryJudgement[],
  kValues: readonly number[],
): Record<number, number | null> {
  const out: Record<number, number | null> = {};
  for (const k of kValues) out[k] = meanAveragePrecisionAtK(judgements, k);
  return out;
}

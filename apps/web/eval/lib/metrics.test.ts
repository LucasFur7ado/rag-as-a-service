import { describe, expect, it } from "vitest";
import {
  aggregate,
  dcgAtK,
  firstRelevantRank,
  groupBy,
  hitRateAtK,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  type QueryJudgement,
} from "./metrics";

/**
 * Fixtures with hand-computed expectations. The point of these tests is that a
 * metric which silently drifts (an off-by-one in a log discount, a recall
 * denominator quietly switched to the retrieved count) still returns a number
 * in [0, 1] and would otherwise never be noticed.
 */

const judgement = (gains: number[], idealGains = gains.filter((g) => g > 0)): QueryJudgement => ({
  gains,
  idealGains,
});

describe("hitRateAtK", () => {
  it("is 1 when a relevant result is inside the cutoff", () => {
    expect(hitRateAtK([0, 0, 1, 0], 3)).toBe(1);
  });

  it("is 0 when the only relevant result falls outside the cutoff", () => {
    expect(hitRateAtK([0, 0, 0, 1], 3)).toBe(0);
  });

  it("is 0 for a list with nothing relevant", () => {
    expect(hitRateAtK([0, 0, 0], 10)).toBe(0);
  });
});

describe("precisionAtK", () => {
  it("divides by k, not by the number of results returned", () => {
    // Two relevant results but only three returned against a cutoff of 10:
    // the seven unfilled slots must count against precision.
    expect(precisionAtK([1, 0, 1], 10)).toBeCloseTo(0.2);
  });

  it("is 1 when every slot in the cutoff is relevant", () => {
    expect(precisionAtK([1, 1, 1, 0], 3)).toBe(1);
  });

  it("is 0 for a non-positive cutoff", () => {
    expect(precisionAtK([1, 1], 0)).toBe(0);
  });
});

describe("recallAtK", () => {
  it("measures against every relevant chunk in the index, retrieved or not", () => {
    // Four relevant chunks exist; two are inside the top 3.
    const j = judgement([1, 0, 1, 0], [1, 1, 1, 1]);
    expect(recallAtK(j, 3)).toBeCloseTo(0.5);
  });

  it("reaches 1 only when all of them are found", () => {
    expect(recallAtK(judgement([1, 1], [1, 1]), 5)).toBe(1);
  });

  it("is null — not 0 — when no relevant chunk exists to be found", () => {
    // A golden span matching nothing is a dataset bug, and blaming retrieval
    // for it would drag the reported average down for the wrong reason.
    expect(recallAtK(judgement([0, 0], []), 5)).toBeNull();
  });
});

describe("firstRelevantRank and reciprocalRank", () => {
  it("reports a 1-based rank", () => {
    expect(firstRelevantRank([0, 1, 1])).toBe(2);
    expect(reciprocalRank([0, 1, 1])).toBeCloseTo(0.5);
  });

  it("reports null / 0 when nothing relevant was retrieved", () => {
    expect(firstRelevantRank([0, 0])).toBeNull();
    expect(reciprocalRank([0, 0])).toBe(0);
  });

  it("gives a perfect reciprocal rank for a hit at rank 1", () => {
    expect(reciprocalRank([1, 0, 0])).toBe(1);
  });
});

describe("dcgAtK", () => {
  it("discounts by log2(rank + 1)", () => {
    // rank 1 → /1, rank 2 → /log2(3), rank 3 → /2
    const expected = 1 + 1 / Math.log2(3) + 1 / 2;
    expect(dcgAtK([1, 1, 1], 3)).toBeCloseTo(expected);
  });

  it("ignores results past the cutoff", () => {
    expect(dcgAtK([1, 0, 0, 1], 2)).toBe(1);
  });

  it("rewards graded gains at better ranks", () => {
    expect(dcgAtK([2, 1], 2)).toBeGreaterThan(dcgAtK([1, 2], 2));
  });
});

describe("ndcgAtK", () => {
  it("is 1 for the ideal ranking", () => {
    expect(ndcgAtK(judgement([1, 1, 0], [1, 1]), 3)).toBeCloseTo(1);
  });

  it("normalises against unretrieved relevant chunks, not just the retrieved ones", () => {
    // One of four relevant chunks was found, and ranked first. Normalising
    // against the retrieved set alone would call this a perfect 1.0.
    const j = judgement([1, 0, 0], [1, 1, 1, 1]);
    const ndcg = ndcgAtK(j, 3)!;
    expect(ndcg).toBeLessThan(0.6);
    expect(ndcg).toBeCloseTo(1 / (1 + 1 / Math.log2(3) + 1 / 2));
  });

  it("penalises a relevant result buried further down", () => {
    const good = ndcgAtK(judgement([1, 0, 0], [1]), 3)!;
    const bad = ndcgAtK(judgement([0, 0, 1], [1]), 3)!;
    expect(good).toBe(1);
    expect(bad).toBeCloseTo(0.5);
  });

  it("is null when nothing relevant exists", () => {
    expect(ndcgAtK(judgement([0, 0], []), 3)).toBeNull();
  });
});

describe("aggregate", () => {
  const judgements: QueryJudgement[] = [
    judgement([1, 0, 0], [1]), // first relevant at rank 1
    judgement([0, 0, 1], [1]), // first relevant at rank 3
    judgement([0, 0, 0], [1]), // complete miss
  ];

  it("averages MRR across queries, counting a miss as zero", () => {
    const set = aggregate(judgements, [3]);
    expect(set.mrr).toBeCloseTo((1 + 1 / 3 + 0) / 3);
  });

  it("counts complete misses and reports rank stats over the hits only", () => {
    const set = aggregate(judgements, [3]);
    expect(set.completeMisses).toBe(1);
    // Mean of ranks 1 and 3 — the miss has no rank to average in.
    expect(set.meanFirstRank).toBeCloseTo(2);
    // Nearest-rank median of [1, 3] is the upper value: index round(0.5 * 1) = 1.
    // This is the same convention the analytics dashboard's percentiles use.
    expect(set.medianFirstRank).toBe(3);
  });

  it("reports hit rate and recall at each requested cutoff", () => {
    const set = aggregate(judgements, [1, 3]);
    expect(set.atK[1].hitRate).toBeCloseTo(1 / 3);
    expect(set.atK[3].hitRate).toBeCloseTo(2 / 3);
    expect(set.atK[3].recall).toBeCloseTo(2 / 3);
  });

  it("flags unjudgeable queries separately from misses", () => {
    const set = aggregate([judgement([0, 0], [])], [3]);
    expect(set.unjudgeable).toBe(1);
    expect(set.completeMisses).toBe(1);
    // No relevant chunk exists, so recall and NDCG have no defined value.
    expect(set.atK[3].recall).toBeNull();
    expect(set.atK[3].ndcg).toBeNull();
  });

  it("handles an empty group without dividing by zero", () => {
    const set = aggregate([], [1, 5]);
    expect(set.queries).toBe(0);
    expect(set.mrr).toBe(0);
    expect(set.atK[5].hitRate).toBe(0);
    expect(set.meanFirstRank).toBeNull();
  });
});

describe("groupBy", () => {
  const items = [
    { id: "a", difficulty: "easy", tags: ["fact", "short"] },
    { id: "b", difficulty: "hard", tags: ["fact"] },
    { id: "c", difficulty: undefined, tags: [] },
  ];

  it("buckets by a single key", () => {
    const groups = groupBy(items, (i) => i.difficulty);
    expect([...groups.keys()].sort()).toEqual(["easy", "hard"]);
    expect(groups.get("easy")).toHaveLength(1);
  });

  it("puts an item in every bucket of a multi-valued key", () => {
    const groups = groupBy(items, (i) => i.tags);
    expect(groups.get("fact")).toHaveLength(2);
    expect(groups.get("short")).toHaveLength(1);
  });

  it("drops items with no key rather than inventing an 'undefined' bucket", () => {
    const groups = groupBy(items, (i) => i.difficulty);
    expect(groups.has("undefined")).toBe(false);
    expect([...groups.values()].flat()).toHaveLength(2);
  });
});

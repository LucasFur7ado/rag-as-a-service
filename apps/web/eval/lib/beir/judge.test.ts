import { describe, expect, it } from "vitest";
import { aggregate, type QueryJudgement } from "../metrics";
import { foldToDocuments, judgeDocumentRanking, missedDocuments } from "./judge";
import { averagePrecisionAtK, meanAveragePrecisionAtK } from "./metrics";

/**
 * The deterministic half of the BEIR harness.
 *
 * Everything asserted here is pure: folding a chunk ranking into a document
 * ranking, turning that ranking plus a qrels map into gains, and MAP. It runs
 * in the normal vitest suite with no secrets and no network, which is the point
 * — these are the functions whose bugs would report a plausible number instead
 * of throwing.
 */

const chunk = (chunkId: string, documentId: string, score: number) => ({
  chunkId,
  documentId,
  score,
});

describe("foldToDocuments", () => {
  it("gives each document the rank of its best-scoring chunk", () => {
    const documents = foldToDocuments([
      chunk("A#0", "A", 0.9),
      chunk("B#1", "B", 0.8),
      chunk("A#3", "A", 0.7),
      chunk("C#0", "C", 0.6),
    ]);

    expect(documents.map((d) => d.documentId)).toEqual(["A", "B", "C"]);
    expect(documents.map((d) => d.rank)).toEqual([1, 2, 3]);
    expect(documents[0].score).toBe(0.9);
    expect(documents[0].chunkId).toBe("A#0");
  });

  it("counts every contributing chunk but emits a document once", () => {
    const documents = foldToDocuments([
      chunk("A#0", "A", 0.9),
      chunk("A#1", "A", 0.85),
      chunk("A#2", "A", 0.8),
      chunk("B#0", "B", 0.5),
    ]);

    expect(documents).toHaveLength(2);
    expect(documents[0].chunkCount).toBe(3);
    expect(documents[1].chunkCount).toBe(1);
  });

  it("sorts by score rather than trusting the input order", () => {
    const documents = foldToDocuments([
      chunk("C#0", "C", 0.1),
      chunk("A#0", "A", 0.9),
      chunk("B#0", "B", 0.5),
    ]);
    expect(documents.map((d) => d.documentId)).toEqual(["A", "B", "C"]);
  });

  it("breaks ties by original position, so the fold is stable", () => {
    const first = foldToDocuments([chunk("A#0", "A", 0.5), chunk("B#0", "B", 0.5)]);
    const second = foldToDocuments([chunk("A#0", "A", 0.5), chunk("B#0", "B", 0.5)]);
    expect(first.map((d) => d.documentId)).toEqual(["A", "B"]);
    expect(second.map((d) => d.documentId)).toEqual(["A", "B"]);
  });

  it("records where in the chunk ranking a document entered", () => {
    const documents = foldToDocuments([
      chunk("A#0", "A", 0.9),
      chunk("A#1", "A", 0.8),
      chunk("B#0", "B", 0.7),
    ]);
    // B is document 2 but was the third chunk — the gap is what tells you how
    // much of the retrieval budget one document consumed.
    expect(documents[1]).toMatchObject({ rank: 2, chunkRank: 3 });
  });

  it("returns nothing for an empty ranking", () => {
    expect(foldToDocuments([])).toEqual([]);
  });
});

describe("judgeDocumentRanking", () => {
  const qrels = new Map([
    ["A", 2],
    ["C", 1],
    ["Z", 1],
  ]);

  it("uses the qrel grade as the gain, and 0 for unjudged documents", () => {
    const documents = foldToDocuments([
      chunk("A#0", "A", 0.9),
      chunk("B#0", "B", 0.8),
      chunk("C#0", "C", 0.7),
    ]);
    expect(judgeDocumentRanking(documents, qrels).gains).toEqual([2, 0, 1]);
  });

  it("puts every positive grade in the ideal ranking, retrieved or not", () => {
    const documents = foldToDocuments([chunk("A#0", "A", 0.9)]);
    // Z was never retrieved but still counts against recall.
    expect(judgeDocumentRanking(documents, qrels).idealGains.sort()).toEqual([1, 1, 2]);
  });

  it("excludes non-positive grades from the ideal ranking", () => {
    const withZero = new Map([
      ["A", 1],
      ["B", 0],
      ["C", -1],
    ]);
    const judgement = judgeDocumentRanking(foldToDocuments([chunk("B#0", "B", 0.9)]), withZero);
    expect(judgement.idealGains).toEqual([1]);
    expect(judgement.gains).toEqual([0]);
  });

  it("treats a query with no judgements as unjudgeable rather than as a miss", () => {
    const judgement = judgeDocumentRanking(foldToDocuments([chunk("A#0", "A", 0.9)]), undefined);
    expect(judgement.idealGains).toEqual([]);
    // aggregate() reports this as unjudgeable and leaves it out of recall/NDCG.
    expect(aggregate([judgement], [10]).unjudgeable).toBe(1);
    expect(aggregate([judgement], [10]).atK[10].recall).toBeNull();
  });
});

describe("judgements feed the shared metric math", () => {
  it("scores a perfect document ranking as perfect", () => {
    const qrels = new Map([
      ["A", 1],
      ["B", 1],
    ]);
    const documents = foldToDocuments([
      chunk("A#0", "A", 0.9),
      chunk("B#0", "B", 0.8),
      chunk("X#0", "X", 0.1),
    ]);
    const metrics = aggregate([judgeDocumentRanking(documents, qrels)], [10]);

    expect(metrics.atK[10].recall).toBe(1);
    expect(metrics.atK[10].ndcg).toBe(1);
    expect(metrics.mrr).toBe(1);
    expect(metrics.completeMisses).toBe(0);
  });

  it("rewards ranking the higher-graded document first", () => {
    const qrels = new Map([
      ["A", 2],
      ["B", 1],
    ]);
    const better = judgeDocumentRanking(
      foldToDocuments([chunk("A#0", "A", 0.9), chunk("B#0", "B", 0.8)]),
      qrels,
    );
    const worse = judgeDocumentRanking(
      foldToDocuments([chunk("B#0", "B", 0.9), chunk("A#0", "A", 0.8)]),
      qrels,
    );

    const betterNdcg = aggregate([better], [10]).atK[10].ndcg!;
    const worseNdcg = aggregate([worse], [10]).atK[10].ndcg!;
    expect(betterNdcg).toBe(1);
    expect(worseNdcg).toBeLessThan(betterNdcg);
  });

  it("does not let one document's extra chunks inflate precision", () => {
    const qrels = new Map([["A", 1]]);
    // Five chunks, all from the same relevant document, then nothing else.
    const documents = foldToDocuments([
      chunk("A#0", "A", 0.9),
      chunk("A#1", "A", 0.88),
      chunk("A#2", "A", 0.86),
      chunk("A#3", "A", 0.84),
      chunk("A#4", "A", 0.82),
    ]);
    const metrics = aggregate([judgeDocumentRanking(documents, qrels)], [5]);

    // One relevant document in five slots, not five relevant results.
    expect(metrics.atK[5].precision).toBeCloseTo(0.2, 10);
    expect(metrics.atK[5].recall).toBe(1);
  });
});

describe("missedDocuments", () => {
  it("lists judged documents that never appeared, worst grade first", () => {
    const qrels = new Map([
      ["A", 1],
      ["B", 2],
      ["C", 1],
    ]);
    const documents = foldToDocuments([chunk("C#0", "C", 0.9)]);

    expect(missedDocuments(documents, qrels)).toEqual([
      { documentId: "B", grade: 2 },
      { documentId: "A", grade: 1 },
    ]);
  });

  it("is empty when everything judged was retrieved", () => {
    const qrels = new Map([["A", 1]]);
    expect(missedDocuments(foldToDocuments([chunk("A#0", "A", 0.9)]), qrels)).toEqual([]);
  });
});

describe("averagePrecisionAtK", () => {
  const judgement = (gains: number[], idealGains: number[]): QueryJudgement => ({
    gains,
    idealGains,
  });

  it("is 1 when every relevant document is ranked first", () => {
    expect(averagePrecisionAtK(judgement([1, 1, 0, 0], [1, 1]), 10)).toBe(1);
  });

  it("averages precision at the ranks holding relevant documents", () => {
    // Relevant at ranks 1 and 3: (1/1 + 2/3) / 2.
    expect(averagePrecisionAtK(judgement([1, 0, 1], [1, 1]), 10)).toBeCloseTo(
      (1 + 2 / 3) / 2,
      10,
    );
  });

  it("normalizes by all relevant documents, not by the cutoff", () => {
    // Four relevant exist, one is found at rank 1, cutoff 2. trec_eval's
    // map_cut divides by 4, so this is 0.25 rather than 1.
    expect(averagePrecisionAtK(judgement([1, 0], [1, 1, 1, 1]), 2)).toBeCloseTo(0.25, 10);
  });

  it("ignores everything past the cutoff", () => {
    expect(averagePrecisionAtK(judgement([0, 0, 1], [1]), 2)).toBe(0);
    expect(averagePrecisionAtK(judgement([0, 0, 1], [1]), 3)).toBeCloseTo(1 / 3, 10);
  });

  it("treats graded relevance as binary, as trec_eval does", () => {
    expect(averagePrecisionAtK(judgement([2, 1], [2, 1]), 10)).toBe(1);
  });

  it("returns null for a query with no relevant documents", () => {
    expect(averagePrecisionAtK(judgement([0, 0], []), 10)).toBeNull();
  });

  it("excludes unjudgeable queries from the mean rather than scoring them 0", () => {
    const scored = judgement([1], [1]);
    const unjudgeable = judgement([0], []);
    expect(meanAveragePrecisionAtK([scored, unjudgeable], 10)).toBe(1);
    expect(meanAveragePrecisionAtK([unjudgeable], 10)).toBeNull();
  });
});

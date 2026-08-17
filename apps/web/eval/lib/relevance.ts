import type { OverlapRule } from "../config";
import type { SourceSpan } from "./types";

/**
 * The relevance judgement: does a retrieved chunk actually contain the answer?
 *
 * Everything in the harness rests on this file. Ground truth is a span of the
 * ORIGINAL document — never a chunk id — so a chunk is judged by *where it came
 * from*, not by what it is called. That is the whole reason one dataset can
 * score a 400-char and a 1200-char chunking config against each other: chunk
 * ids and boundaries change between them, source offsets do not.
 *
 * Pure functions over plain numbers, unit-tested in relevance.test.ts. A bug
 * here does not throw; it quietly reports the wrong retrieval quality, which is
 * worse.
 */

/** A comparable region of a document. `page` null/undefined both mean unpaged. */
export interface ComparableSpan {
  startChar: number;
  endChar: number;
  page?: number | null;
}

/** Two spans are on the same page when their page numbers agree. */
function samePage(a: ComparableSpan, b: ComparableSpan): boolean {
  return (a.page ?? null) === (b.page ?? null);
}

/**
 * Overlapping characters between two spans on the same page; 0 when they are on
 * different pages, which is the point of carrying the page at all — offset 500
 * of page 2 has nothing to do with offset 500 of page 7.
 */
export function overlapChars(a: ComparableSpan, b: ComparableSpan): number {
  if (!samePage(a, b)) return 0;
  return Math.max(0, Math.min(a.endChar, b.endChar) - Math.max(a.startChar, b.startChar));
}

/** Fraction of `golden` covered by `chunk`, in [0, 1]. */
export function goldenCoverage(chunk: ComparableSpan, golden: ComparableSpan): number {
  const goldenLength = golden.endChar - golden.startChar;
  if (goldenLength <= 0) return 0;
  return overlapChars(chunk, golden) / goldenLength;
}

/**
 * Whether one chunk satisfies the rule for one golden span.
 *
 * `mode: "any"` (the default) asks whether the chunk is *useful*: it holds some
 * of the answer, even a fragment. `mode: "all"` asks whether it is
 * *sufficient*: it holds most of the answer on its own. Which question you are
 * asking changes the numbers a lot, so the rule is recorded in every result
 * file and printed in every report.
 */
export function matchesSpan(
  chunk: ComparableSpan,
  golden: ComparableSpan,
  rule: OverlapRule,
): boolean {
  const overlap = overlapChars(chunk, golden);
  // Disjoint spans are never relevant, whatever the rule says. Without this,
  // a rule with `minGoldenCoverage: 0` would satisfy the coverage clause for
  // every chunk in the corpus and mark the entire index relevant.
  if (overlap <= 0) return false;

  const meetsOverlap = overlap >= Math.max(1, rule.minOverlapChars);
  const meetsCoverage = goldenCoverage(chunk, golden) >= rule.minGoldenCoverage;
  return rule.mode === "all"
    ? meetsOverlap && meetsCoverage
    : meetsOverlap || meetsCoverage;
}

/**
 * Graded relevance: how many of an item's golden spans this chunk satisfies.
 *
 * 0 means irrelevant. For a single-span item the result is 0 or 1 and NDCG
 * degrades to its binary form; for a multi-span item a chunk covering two
 * supporting passages outranks one covering a single passage, which is the
 * ranking NDCG is meant to reward.
 */
export function relevanceGain(
  chunk: ComparableSpan,
  goldens: readonly ComparableSpan[],
  rule: OverlapRule,
): number {
  let gain = 0;
  for (const golden of goldens) if (matchesSpan(chunk, golden, rule)) gain++;
  return gain;
}

/** Convenience wrapper over {@link relevanceGain} for a typed golden item. */
export function isChunkRelevant(
  chunk: ComparableSpan,
  goldens: readonly SourceSpan[],
  rule: OverlapRule,
): boolean {
  return relevanceGain(chunk, goldens, rule) > 0;
}

/** Human-readable form of a rule, for report headers and result files. */
export function describeRule(rule: OverlapRule): string {
  const overlap = `overlap >= ${rule.minOverlapChars} char${rule.minOverlapChars === 1 ? "" : "s"}`;
  const coverage = `covers >= ${Math.round(rule.minGoldenCoverage * 100)}% of the golden span`;
  return `${overlap} ${rule.mode === "all" ? "AND" : "OR"} ${coverage}`;
}

import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAP_RULE, type OverlapRule } from "../config";
import {
  describeRule,
  goldenCoverage,
  matchesSpan,
  overlapChars,
  relevanceGain,
} from "./relevance";

/**
 * These fixtures encode the claim the whole harness rests on: that relevance
 * depends only on WHERE a chunk came from, so the same dataset can score
 * chunking configurations that produce entirely different chunks.
 */

const golden = { startChar: 100, endChar: 200 };

describe("overlapChars", () => {
  it("measures the intersection of two spans", () => {
    expect(overlapChars({ startChar: 150, endChar: 250 }, golden)).toBe(50);
  });

  it("is 0 for disjoint spans", () => {
    expect(overlapChars({ startChar: 0, endChar: 100 }, golden)).toBe(0);
    expect(overlapChars({ startChar: 200, endChar: 300 }, golden)).toBe(0);
  });

  it("is 0 across different pages even when the offsets coincide", () => {
    const a = { startChar: 100, endChar: 200, page: 2 };
    const b = { startChar: 100, endChar: 200, page: 7 };
    expect(overlapChars(a, b)).toBe(0);
  });

  it("treats a null page and a missing page as the same unpaged document", () => {
    const a = { startChar: 100, endChar: 200, page: null };
    expect(overlapChars(a, golden)).toBe(100);
  });
});

describe("goldenCoverage", () => {
  it("is the fraction of the golden span covered, not of the chunk", () => {
    // A huge chunk fully containing a small golden span covers 100% of it.
    expect(goldenCoverage({ startChar: 0, endChar: 5000 }, golden)).toBe(1);
    expect(goldenCoverage({ startChar: 150, endChar: 200 }, golden)).toBeCloseTo(0.5);
  });
});

describe("matchesSpan with the default rule", () => {
  it("accepts a chunk holding only a fragment of the answer", () => {
    // One character of overlap. Deliberate: a chunk with the tail of the answer
    // is still a retrieval the user benefits from.
    const chunk = { startChar: 199, endChar: 400 };
    expect(matchesSpan(chunk, golden, DEFAULT_OVERLAP_RULE)).toBe(true);
  });

  it("rejects a chunk that stops just short of the golden span", () => {
    expect(matchesSpan({ startChar: 0, endChar: 100 }, golden, DEFAULT_OVERLAP_RULE)).toBe(
      false,
    );
  });
});

describe("matchesSpan with a strict rule", () => {
  const strict: OverlapRule = {
    minOverlapChars: 20,
    minGoldenCoverage: 0.5,
    mode: "all",
  };

  it("requires both conditions", () => {
    // 60 chars of overlap, but only 60% coverage — passes both.
    expect(matchesSpan({ startChar: 140, endChar: 400 }, golden, strict)).toBe(true);
    // 10 chars of overlap: fails the character floor despite being inside.
    expect(matchesSpan({ startChar: 190, endChar: 400 }, golden, strict)).toBe(false);
  });

  it("rejects a fragment that the default rule would accept", () => {
    const fragment = { startChar: 199, endChar: 400 };
    expect(matchesSpan(fragment, golden, DEFAULT_OVERLAP_RULE)).toBe(true);
    expect(matchesSpan(fragment, golden, strict)).toBe(false);
  });

  it("never lets a 0-char overlap through, even at minOverlapChars 0", () => {
    const permissive: OverlapRule = {
      minOverlapChars: 0,
      minGoldenCoverage: 0,
      mode: "any",
    };
    expect(matchesSpan({ startChar: 0, endChar: 100 }, golden, permissive)).toBe(false);
  });
});

describe("relevanceGain", () => {
  const spans = [
    { startChar: 100, endChar: 200 },
    { startChar: 300, endChar: 400 },
  ];

  it("counts how many golden spans a chunk satisfies", () => {
    expect(relevanceGain({ startChar: 0, endChar: 5000 }, spans, DEFAULT_OVERLAP_RULE)).toBe(2);
    expect(relevanceGain({ startChar: 150, endChar: 250 }, spans, DEFAULT_OVERLAP_RULE)).toBe(1);
    expect(relevanceGain({ startChar: 210, endChar: 290 }, spans, DEFAULT_OVERLAP_RULE)).toBe(0);
  });
});

describe("chunking-config independence", () => {
  it("judges the same answer location relevant under different chunk sizes", () => {
    // The same passage, cut two ways. Chunk ids and boundaries differ; both
    // configs must still be credited with retrieving the answer.
    const smallChunks = [
      { startChar: 0, endChar: 120 },
      { startChar: 120, endChar: 240 },
    ];
    const largeChunks = [{ startChar: 0, endChar: 400 }];

    const hitSmall = smallChunks.filter((c) =>
      matchesSpan(c, golden, DEFAULT_OVERLAP_RULE),
    );
    const hitLarge = largeChunks.filter((c) =>
      matchesSpan(c, golden, DEFAULT_OVERLAP_RULE),
    );

    expect(hitSmall.length).toBeGreaterThan(0);
    expect(hitLarge.length).toBeGreaterThan(0);
  });
});

describe("describeRule", () => {
  it("renders the default rule as a disjunction", () => {
    expect(describeRule(DEFAULT_OVERLAP_RULE)).toBe(
      "overlap >= 1 char OR covers >= 50% of the golden span",
    );
  });

  it("renders a strict rule as a conjunction", () => {
    expect(describeRule({ minOverlapChars: 20, minGoldenCoverage: 0.8, mode: "all" })).toBe(
      "overlap >= 20 chars AND covers >= 80% of the golden span",
    );
  });
});

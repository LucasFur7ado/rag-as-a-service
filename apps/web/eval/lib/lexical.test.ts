import { describe, expect, it } from "vitest";
import { contentWords, isNearDuplicate, questionCoverage, wordJaccard } from "./lexical";

describe("contentWords", () => {
  it("lowercases, splits on punctuation, and drops stopwords", () => {
    expect(contentWords("What is the Chunk Overlap?")).toEqual(["chunk", "overlap"]);
  });

  it("drops single characters but keeps numbers", () => {
    expect(contentWords("a 900 x 135 window")).toEqual(["900", "135", "window"]);
  });

  it("handles markdown and accented text without inventing tokens", () => {
    // "out" survives: the stopword list is deliberately minimal and only needs
    // to strip question scaffolding, not every function word.
    expect(contentWords("**Ré-ranking** (out of scope)")).toEqual([
      "ré",
      "ranking",
      "out",
      "scope",
    ]);
  });

  it("returns nothing for text made only of stopwords", () => {
    expect(contentWords("what is the")).toEqual([]);
  });
});

describe("wordJaccard", () => {
  it("is 1 for the same content words", () => {
    expect(wordJaccard("chunk overlap size", "the chunk overlap size")).toBe(1);
  });

  it("is 0 for disjoint vocabulary", () => {
    expect(wordJaccard("chunking strategy", "billing invoices")).toBe(0);
  });

  it("is 0 when either side has no content words", () => {
    expect(wordJaccard("what is the", "chunk overlap")).toBe(0);
  });

  it("falls as the shared vocabulary shrinks", () => {
    const high = wordJaccard("recursive chunking overlap", "recursive chunking window");
    const low = wordJaccard("recursive chunking overlap", "pinecone namespace isolation");
    expect(high).toBeGreaterThan(low);
  });
});

describe("questionCoverage", () => {
  const passage =
    "Recursive character chunking splits text on the coarsest separator that helps, " +
    "carrying whole trailing pieces forward as overlap.";

  it("is 1 for a question copied out of the passage", () => {
    // Exactly the failure mode the filter exists to catch: every content word
    // of the question appears verbatim in the passage.
    expect(questionCoverage("What is recursive character chunking overlap?", passage)).toBe(1);
  });

  it("is lower for a question that paraphrases", () => {
    const coverage = questionCoverage(
      "How does the splitter decide where one passage ends and the next begins?",
      passage,
    );
    expect(coverage).toBeLessThan(0.5);
  });

  it("stays high for a short copied question even when the passage is long", () => {
    // The reason coverage is used alongside Jaccard: Jaccard is dragged down by
    // the length mismatch here, coverage is not.
    const long = `${passage} ${"Additional unrelated sentences. ".repeat(30)}`;
    expect(questionCoverage("What is chunking overlap?", long)).toBe(1);
    expect(wordJaccard("What is chunking overlap?", long)).toBeLessThan(0.2);
  });

  it("is 0 for a question with no content words", () => {
    expect(questionCoverage("what is the", passage)).toBe(0);
  });
});

describe("isNearDuplicate", () => {
  const accepted = ["How does chunk overlap affect retrieval recall?"];

  it("catches a reworded repeat", () => {
    expect(isNearDuplicate("How does chunk overlap affect recall retrieval?", accepted, 0.7)).toBe(
      true,
    );
  });

  it("allows a genuinely different question", () => {
    expect(isNearDuplicate("Which metric penalises a buried result?", accepted, 0.7)).toBe(false);
  });

  it("accepts anything against an empty set", () => {
    expect(isNearDuplicate("Any question at all?", [], 0.7)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { chunkPages, splitTextRecursive } from "./chunking";

/**
 * The load-bearing property of this module is that a chunk's `[startChar,
 * endChar)` offsets address the exact region of the *caller's* text that the
 * chunk was cut from. The eval harness (apps/web/eval) judges relevance by
 * overlapping those offsets with golden source spans, so drift here does not
 * crash anything — it silently reports the wrong retrieval quality.
 */

const LOREM = [
  "Retrieval-augmented generation grounds a language model in retrieved text.",
  "The retriever finds passages; the generator is instructed to use only those.",
  "Chunking decides what a passage is, so it bounds the quality of everything after it.",
  "Too large a chunk buries the answer in noise and wastes the context budget.",
  "Too small a chunk splits the answer across boundaries and neither half retrieves.",
].join("\n\n");

/**
 * Every chunk must be a contiguous slice of the source text at its offsets.
 *
 * The comparison drops CRs because that is the chunker's one normalization: a
 * chunk cut from CRLF text has LF-only text but still reports offsets into the
 * caller's CRLF original, which is what a golden span is authored against.
 */
function expectOffsetsAddressTheText(source: string, chunkSize = 120, overlap = 20) {
  const chunks = splitTextRecursive(source, chunkSize, overlap);
  expect(chunks.length).toBeGreaterThan(0);
  for (const chunk of chunks) {
    const sliced = source.slice(chunk.startChar, chunk.endChar).replace(/\r\n/g, "\n");
    expect(sliced).toBe(chunk.text);
  }
  return chunks;
}

describe("splitTextRecursive offsets", () => {
  it("addresses the exact source text for prose", () => {
    const chunks = splitTextRecursive(LOREM, 120, 20);
    // No CRs in this source, so the slice must match byte for byte.
    for (const chunk of chunks) {
      expect(LOREM.slice(chunk.startChar, chunk.endChar)).toBe(chunk.text);
    }
  });

  it("survives CRLF line endings, which the chunker normalizes away", () => {
    const crlf = LOREM.replace(/\n/g, "\r\n");
    const chunks = expectOffsetsAddressTheText(crlf);
    // Normalization drops the CR, so chunk text must not contain one even
    // though the offsets still index the CRLF original.
    for (const chunk of chunks) expect(chunk.text).not.toContain("\r");
  });

  it("survives leading and trailing whitespace, which is trimmed", () => {
    const padded = `\n\n\t  ${LOREM}   \n\n`;
    const chunks = expectOffsetsAddressTheText(padded);
    expect(chunks[0].startChar).toBeGreaterThan(0);
    expect(chunks[0].text.startsWith("Retrieval")).toBe(true);
  });

  it("survives a hard split of unbroken text with no separators", () => {
    const unbroken = "x".repeat(500);
    const chunks = expectOffsetsAddressTheText(unbroken, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("survives a long unbroken run that exceeds the overlap budget", () => {
    // Forces the carried-tail fallback: the trailing piece is longer than the
    // overlap, so no whole piece fits and a character tail is carried instead.
    const source = `${"y".repeat(300)} then some ordinary trailing words here`;
    expectOffsetsAddressTheText(source, 120, 20);
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(splitTextRecursive("")).toEqual([]);
    expect(splitTextRecursive("   \n\t\r\n  ")).toEqual([]);
  });

  it("returns the whole text as one chunk when it fits", () => {
    const short = "A single short passage.";
    const [chunk, ...rest] = splitTextRecursive(short, 900, 135);
    expect(rest).toHaveLength(0);
    expect(chunk).toEqual({ text: short, startChar: 0, endChar: short.length });
  });
});

describe("splitTextRecursive sizing", () => {
  it("respects the chunk size", () => {
    for (const chunk of splitTextRecursive(LOREM, 120, 20)) {
      expect(chunk.text.length).toBeLessThanOrEqual(120);
    }
  });

  it("emits chunks in ascending, non-nested source order", () => {
    const chunks = splitTextRecursive(LOREM, 120, 20);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startChar).toBeGreaterThan(chunks[i - 1].startChar);
      expect(chunks[i].endChar).toBeGreaterThan(chunks[i - 1].endChar);
    }
  });

  it("overlaps consecutive chunks when an overlap is configured", () => {
    const chunks = splitTextRecursive(LOREM, 120, 40);
    expect(chunks.length).toBeGreaterThan(1);
    // At least one boundary must actually carry text forward.
    const overlapping = chunks.slice(1).some((chunk, i) => chunk.startChar < chunks[i].endChar);
    expect(overlapping).toBe(true);
  });

  it("does not overlap when the overlap is zero", () => {
    const chunks = splitTextRecursive(LOREM, 120, 0);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startChar).toBeGreaterThanOrEqual(chunks[i - 1].endChar);
    }
  });
});

describe("chunkPages", () => {
  it("numbers chunks across pages and keeps offsets page-relative", () => {
    const pages = [
      { page: 1, text: LOREM },
      { page: 2, text: LOREM },
    ];
    const chunks = chunkPages(pages, 120, 20);

    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));

    for (const chunk of chunks) {
      const source = pages.find((p) => p.page === chunk.page)!.text;
      expect(source.slice(chunk.startChar, chunk.endChar)).toBe(chunk.text);
    }
    // Page 2 restarts at offset 0 rather than continuing page 1's numbering.
    expect(chunks.find((c) => c.page === 2)!.startChar).toBe(0);
  });

  it("carries a null page for unpaged sources", () => {
    const [chunk] = chunkPages([{ page: null, text: "Short unpaged text." }], 900, 135);
    expect(chunk.page).toBeNull();
    expect(chunk.startChar).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  beirDocumentText,
  fingerprintBeirCorpus,
  parseCorpusJsonl,
  parseQrelsTsv,
  parseQueriesJsonl,
  shuffled,
} from "./dataset";

/**
 * Parsing a BEIR dataset off disk, tested on inline fixtures.
 *
 * The parsing is where a silent failure is cheapest to produce and most
 * expensive to notice: a qrels file read with the wrong line ending yields NaN
 * grades, which does not throw — it reports a retrieval system that finds
 * nothing. Every case below is one that produced a plausible wrong number
 * rather than an error.
 */

const jsonl = (...rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

describe("beirDocumentText", () => {
  it("joins title and body, which is the convention BEIR numbers assume", () => {
    expect(beirDocumentText("Statins", "A cohort study.")).toBe("Statins\n\nA cohort study.");
  });

  it("omits the separator when either half is missing", () => {
    expect(beirDocumentText("", "Body only.")).toBe("Body only.");
    expect(beirDocumentText("Title only", "")).toBe("Title only");
    expect(beirDocumentText("  ", "  ")).toBe("");
  });
});

describe("parseCorpusJsonl", () => {
  it("reads documents as single unpaged pages, sorted by id", () => {
    const { documents, titles } = parseCorpusJsonl(
      jsonl(
        { _id: "MED-2", title: "Second", text: "Two." },
        { _id: "MED-1", title: "First", text: "One." },
      ),
    );

    expect(documents.map((doc) => doc.documentId)).toEqual(["MED-1", "MED-2"]);
    expect(documents[0].pages).toEqual([{ page: null, text: "First\n\nOne." }]);
    expect(documents[0].totalChars).toBe("First\n\nOne.".length);
    expect(titles.get("MED-2")).toBe("Second");
  });

  it("skips a document with no text at all", () => {
    const { documents } = parseCorpusJsonl(
      jsonl({ _id: "A", title: "", text: "   " }, { _id: "B", title: "B", text: "b" }),
    );
    expect(documents.map((doc) => doc.documentId)).toEqual(["B"]);
  });

  it("rejects an id containing the chunk-id separator", () => {
    // `${documentId}#${chunkIndex}` is split back apart on the "#", so this
    // would corrupt the chunk-to-document mapping instead of failing.
    expect(() => parseCorpusJsonl(jsonl({ _id: "MED#1", text: "x" }))).toThrow(/contains "#"/);
  });

  it("rejects duplicate ids", () => {
    expect(() => parseCorpusJsonl(jsonl({ _id: "A", text: "x" }, { _id: "A", text: "y" }))).toThrow(
      /duplicate document id/,
    );
  });

  it("reports the line number of malformed JSON", () => {
    expect(() => parseCorpusJsonl('{"_id":"A","text":"x"}\nnot json\n', "corpus.jsonl")).toThrow(
      /corpus\.jsonl:2/,
    );
  });

  it("tolerates CRLF line endings", () => {
    const contents = '{"_id":"A","title":"T","text":"x"}\r\n{"_id":"B","title":"U","text":"y"}\r\n';
    expect(parseCorpusJsonl(contents).documents).toHaveLength(2);
  });
});

describe("parseQueriesJsonl", () => {
  it("keeps id and trimmed text", () => {
    const queries = parseQueriesJsonl(jsonl({ _id: "PLAIN-3", text: "  Why statins?  " }));
    expect(queries).toEqual([{ id: "PLAIN-3", text: "Why statins?" }]);
  });

  it("skips an empty query rather than embedding whitespace", () => {
    expect(parseQueriesJsonl(jsonl({ _id: "PLAIN-1", text: "   " }))).toEqual([]);
  });
});

describe("parseQrelsTsv", () => {
  const header = "query-id\tcorpus-id\tscore\n";

  it("skips the header and reads graded judgements", () => {
    const qrels = parseQrelsTsv(`${header}PLAIN-2\tMED-10\t2\nPLAIN-2\tMED-11\t1\n`);
    expect(qrels.get("PLAIN-2")).toEqual(
      new Map([
        ["MED-10", 2],
        ["MED-11", 1],
      ]),
    );
  });

  it("survives the CRLF endings the published archives ship", () => {
    // Score is the last field, so a surviving carriage return makes every grade
    // NaN — a whole benchmark reporting zero relevance, with no error raised.
    const qrels = parseQrelsTsv(`${header.trimEnd()}\r\nPLAIN-2\tMED-10\t2\r\n`);
    expect(qrels.get("PLAIN-2")?.get("MED-10")).toBe(2);
  });

  it("drops non-positive grades instead of treating them as relevant", () => {
    const qrels = parseQrelsTsv(`${header}Q\tD1\t0\nQ\tD2\t1\n`);
    expect(qrels.get("Q")).toEqual(new Map([["D2", 1]]));
  });

  it("works on a file with no header row", () => {
    expect(parseQrelsTsv("Q\tD1\t1\n").get("Q")?.get("D1")).toBe(1);
  });

  it("rejects a malformed row rather than skipping it", () => {
    expect(() => parseQrelsTsv(`${header}Q\tD1\n`, "test.tsv")).toThrow(/test\.tsv:2/);
    expect(() => parseQrelsTsv(`${header}Q\tD1\tabc\n`, "test.tsv")).toThrow(/not a number/);
  });

  it("omits a query whose judgements were all dropped", () => {
    expect(parseQrelsTsv(`${header}Q\tD1\t0\n`).has("Q")).toBe(false);
  });
});

describe("deterministic sampling", () => {
  const counter = (start: number) => {
    // A stand-in "random" source: predictable, so the shuffle is assertable.
    let n = start;
    return () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  };

  it("produces the same order for the same random source", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    expect(shuffled(items, counter(7))).toEqual(shuffled(items, counter(7)));
  });

  it("does not mutate the input", () => {
    const items = ["a", "b", "c"];
    shuffled(items, counter(1));
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("keeps every element", () => {
    const items = ["a", "b", "c", "d"];
    expect([...shuffled(items, counter(3))].sort()).toEqual(items);
  });
});

describe("fingerprintBeirCorpus", () => {
  const docs = (texts: Record<string, string>) =>
    Object.entries(texts).map(([documentId, text]) => ({
      documentId,
      filename: `${documentId}.txt`,
      pages: [{ page: null, text }],
      totalChars: text.length,
    }));

  it("is stable for the same document set", () => {
    const a = fingerprintBeirCorpus("nfcorpus", "test", docs({ A: "one", B: "two" }));
    const b = fingerprintBeirCorpus("nfcorpus", "test", docs({ A: "one", B: "two" }));
    expect(a).toBe(b);
  });

  it("changes when a document's text changes", () => {
    // Without this, re-downloading a corrected dataset release would silently
    // reuse the vectors built from the old one.
    const before = fingerprintBeirCorpus("nfcorpus", "test", docs({ A: "one" }));
    const after = fingerprintBeirCorpus("nfcorpus", "test", docs({ A: "ONE" }));
    expect(before).not.toBe(after);
  });

  it("changes when the sample changes", () => {
    const full = fingerprintBeirCorpus("nfcorpus", "test", docs({ A: "one", B: "two" }));
    const sampled = fingerprintBeirCorpus("nfcorpus", "test", docs({ A: "one" }));
    expect(full).not.toBe(sampled);
  });

  it("distinguishes datasets and splits", () => {
    const test = fingerprintBeirCorpus("nfcorpus", "test", docs({ A: "one" }));
    expect(fingerprintBeirCorpus("scifact", "test", docs({ A: "one" }))).not.toBe(test);
    expect(fingerprintBeirCorpus("nfcorpus", "dev", docs({ A: "one" }))).not.toBe(test);
  });
});

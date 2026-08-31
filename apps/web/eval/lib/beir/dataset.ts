import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { BEIR_DOWNLOAD_URL_TEMPLATE, BEIR_SEARCH_ROOTS } from "../../config";
import type { CorpusDocument } from "../corpus";

/**
 * Loading a BEIR benchmark dataset off disk.
 *
 * BEIR ships every dataset in the same three-file shape, which is the only
 * reason one loader covers NFCorpus, SciFact, FiQA and the rest:
 *
 *   corpus.jsonl       {"_id": "MED-10", "title": "...", "text": "..."}
 *   queries.jsonl      {"_id": "PLAIN-3", "text": "..."}
 *   qrels/<split>.tsv  query-id, corpus-id, score — tab separated, with a header
 *
 * The output is deliberately `CorpusDocument[]` — the same type the committed
 * corpus loads into — so `buildChunks` and `ensureIndexed` index a BEIR corpus
 * with the production chunker and no special case anywhere.
 *
 * What is NOT shared is the answer key. A BEIR qrel names a whole document and
 * carries a graded score; the custom golden set names a character span. That
 * difference is the whole reason this directory exists — see `judge.ts`.
 */

export type BeirSplit = "train" | "dev" | "test";

export const BEIR_SPLITS: readonly BeirSplit[] = ["train", "dev", "test"];

export interface BeirQuery {
  id: string;
  text: string;
}

/** What a run actually loaded, versus what the dataset holds. */
export interface BeirSampling {
  queriesAvailable: number;
  queriesUsed: number;
  documentsAvailable: number;
  documentsUsed: number;
  seed: number;
  /**
   * True when the corpus was cut down. The single most important caveat a BEIR
   * report can carry: a smaller corpus is a smaller haystack, so every metric
   * rises for reasons that have nothing to do with retrieval quality, and the
   * run stops being comparable to a published number.
   */
  pooledCorpus: boolean;
  /** Qrel entries naming a document id absent from the corpus file. */
  danglingQrels: number;
}

export interface BeirDataset {
  name: string;
  split: BeirSplit;
  dir: string;
  documents: CorpusDocument[];
  queries: BeirQuery[];
  /** Document titles, for making a report readable. Never used in scoring. */
  titles: Map<string, string>;
  /** queryId -> (documentId -> graded relevance). Only entries with score > 0. */
  qrels: Map<string, Map<string, number>>;
  /** Content hash of the exact document set indexed. Names the namespace. */
  fingerprint: string;
  sampling: BeirSampling;
  totalChars: number;
}

// --- Locating a dataset -----------------------------------------------------

/**
 * Find a dataset directory by name.
 *
 * Checked in order: an explicit `--data` path, `$BEIR_DATA_DIR/<name>`, then
 * each of BEIR_SEARCH_ROOTS. The repository root is one of those because an
 * unzipped BEIR download naturally lands there, which is where `nfcorpus/`
 * already is.
 */
export function resolveDatasetDir(name: string, explicit?: string): string {
  const candidates: string[] = [];
  if (explicit) {
    candidates.push(isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit));
  }

  const fromEnv = process.env.BEIR_DATA_DIR?.trim();
  if (fromEnv) candidates.push(resolve(fromEnv, name));

  for (const root of BEIR_SEARCH_ROOTS) candidates.push(resolve(root, name));

  for (const dir of candidates) {
    if (existsSync(resolve(dir, "corpus.jsonl"))) return dir;
  }

  throw new Error(
    `Could not find the BEIR dataset "${name}". Looked for corpus.jsonl in:\n` +
      candidates.map((c) => `  - ${c}`).join("\n") +
      `\n\nDownload it from ${BEIR_DOWNLOAD_URL_TEMPLATE.replace("{name}", name)} and unzip it ` +
      `into one of those locations, or point at it with --data <path>.`,
  );
}

/** Splits a dataset actually ships qrels for. */
export function availableSplits(dir: string): BeirSplit[] {
  const qrelsDir = resolve(dir, "qrels");
  if (!existsSync(qrelsDir)) return [];
  const present = new Set(readdirSync(qrelsDir).map((file) => file.replace(/\.tsv$/, "")));
  return BEIR_SPLITS.filter((split) => present.has(split));
}

// --- Parsing ----------------------------------------------------------------

interface CorpusLine {
  _id?: unknown;
  title?: unknown;
  text?: unknown;
}

/**
 * The text that actually gets embedded for a BEIR document.
 *
 * Title and body are concatenated, which is the convention every published BEIR
 * number is measured under — for a short abstract the title is often the most
 * retrievable part of it, and dropping it would report a handicapped system.
 * Exported because it is the thing to change to measure the alternative, and
 * because the corpus fingerprint depends on it.
 */
export function beirDocumentText(title: string, text: string): string {
  const head = title.trim();
  const body = text.trim();
  if (!head) return body;
  if (!body) return head;
  return `${head}\n\n${body}`;
}

/** Parse `corpus.jsonl` into id-ordered documents plus their titles. */
export function parseCorpusJsonl(
  contents: string,
  source = "corpus.jsonl",
): { documents: CorpusDocument[]; titles: Map<string, string> } {
  const documents: CorpusDocument[] = [];
  const titles = new Map<string, string>();
  const seen = new Set<string>();

  eachJsonLine<CorpusLine>(contents, source, (row, lineNo) => {
    const id = String(row._id ?? "").trim();
    if (!id) throw new Error(`${source}:${lineNo} has no "_id"`);

    // Vector ids are `${documentId}#${chunkIndex}` and are split back apart on
    // the "#" when a match is mapped to its document, so a "#" inside an id
    // would silently corrupt that mapping rather than fail.
    if (id.includes("#")) {
      throw new Error(
        `${source}:${lineNo}: document id "${id}" contains "#", which is the chunk-id separator ` +
          `(see vectorId in src/server/services/vectorstore.ts). This dataset needs its ids ` +
          `remapped before it can be indexed.`,
      );
    }
    if (seen.has(id)) throw new Error(`${source}:${lineNo}: duplicate document id "${id}"`);
    seen.add(id);

    const title = typeof row.title === "string" ? row.title : "";
    const text = beirDocumentText(title, typeof row.text === "string" ? row.text : "");
    // An empty document cannot be chunked and cannot be retrieved. Skipping it
    // here keeps it out of the index; if an answer key names it, that shows up
    // as a dangling qrel, which is counted and reported.
    if (!text) return;

    titles.set(id, title.trim());
    documents.push({
      documentId: id,
      // BEIR has no filenames. This synthetic one is what `filename` metadata
      // carries into the index and what a citation would display.
      filename: `${id}.txt`,
      // One unpaged entry, exactly as txt/markdown extracts — so chunk offsets
      // index the whole document and `page` is null throughout.
      pages: [{ page: null, text }],
      totalChars: text.length,
    });
  });

  documents.sort((a, b) => a.documentId.localeCompare(b.documentId));
  return { documents, titles };
}

interface QueryLine {
  _id?: unknown;
  text?: unknown;
}

/** Parse `queries.jsonl`. File order is preserved; sampling re-orders it. */
export function parseQueriesJsonl(contents: string, source = "queries.jsonl"): BeirQuery[] {
  const queries: BeirQuery[] = [];
  eachJsonLine<QueryLine>(contents, source, (row, lineNo) => {
    const id = String(row._id ?? "").trim();
    if (!id) throw new Error(`${source}:${lineNo} has no "_id"`);
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) return;
    queries.push({ id, text });
  });
  return queries;
}

/**
 * Parse a qrels TSV into `queryId -> documentId -> grade`.
 *
 * Tolerates the header row BEIR ships and the CRLF line endings its published
 * archives use. The CRLF is not a cosmetic detail: score is the last field, so
 * a surviving carriage return turns every grade into NaN — which reads as
 * "nothing is relevant anywhere" rather than as a parse error, and would report
 * a retrieval system that finds nothing.
 *
 * Non-positive grades are dropped. TREC treats 0 as an explicit judgement of
 * *not* relevant, which is not the same as relevant-with-gain-0 and must not
 * enter the ideal ranking.
 */
export function parseQrelsTsv(
  contents: string,
  source = "qrels.tsv",
): Map<string, Map<string, number>> {
  const qrels = new Map<string, Map<string, number>>();
  const lines = contents.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = line.split("\t").map((field) => field.trim());
    if (fields.length < 3) {
      throw new Error(
        `${source}:${i + 1} has ${fields.length} tab-separated field(s), expected 3 ` +
          `(query-id, corpus-id, score)`,
      );
    }
    const [queryId, documentId, rawScore] = fields;

    // The header BEIR writes is `query-id  corpus-id  score`; only the first
    // line is allowed to be non-numeric, so a malformed row further down still
    // fails loudly instead of being skipped as "probably a header".
    if (i === 0 && !/^-?\d+(\.\d+)?$/.test(rawScore)) continue;

    const score = Number(rawScore);
    if (!Number.isFinite(score)) {
      throw new Error(`${source}:${i + 1}: score "${rawScore}" is not a number`);
    }
    if (score <= 0) continue;

    let forQuery = qrels.get(queryId);
    if (!forQuery) {
      forQuery = new Map<string, number>();
      qrels.set(queryId, forQuery);
    }
    forQuery.set(documentId, score);
  }
  return qrels;
}

function eachJsonLine<T>(
  contents: string,
  source: string,
  visit: (row: T, lineNo: number) => void,
): void {
  const lines = contents.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let row: T;
    try {
      row = JSON.parse(line) as T;
    } catch (err) {
      throw new Error(
        `${source}:${i + 1} is not valid JSON — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    visit(row, i + 1);
  }
}

// --- Deterministic sampling -------------------------------------------------

/**
 * A small seeded PRNG (mulberry32), so a sampled run is reproducible.
 *
 * Reproducibility is not a nicety here. The sampled document set determines the
 * corpus fingerprint, which determines the namespace, so an unseeded sample
 * would index — and pay for — a different corpus on every single run.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy, driven by `random`. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface LoadBeirOptions {
  name: string;
  split: BeirSplit;
  /** Explicit dataset directory; otherwise resolved by name. */
  dir?: string;
  /** Keep at most this many queries (seeded sample). */
  maxQueries?: number;
  /**
   * Keep at most this many documents in the index.
   *
   * Every document the selected queries are judged against is kept
   * unconditionally — dropping one deletes ground truth and understates recall
   * — and the rest of the budget is filled with a seeded sample of unjudged
   * documents acting as distractors.
   */
  maxDocuments?: number;
  seed: number;
}

export function loadBeirDataset(options: LoadBeirOptions): BeirDataset {
  const dir = options.dir ?? resolveDatasetDir(options.name);
  const qrelsPath = resolve(dir, "qrels", `${options.split}.tsv`);
  if (!existsSync(qrelsPath)) {
    const have = availableSplits(dir);
    throw new Error(
      `${options.name} has no "${options.split}" split (${qrelsPath} does not exist). ` +
        (have.length > 0 ? `Available: ${have.join(", ")}.` : "There is no qrels directory at all."),
    );
  }

  const corpusPath = resolve(dir, "corpus.jsonl");
  const queriesPath = resolve(dir, "queries.jsonl");

  const { documents: allDocuments, titles } = parseCorpusJsonl(
    readFileSync(corpusPath, "utf8"),
    corpusPath,
  );
  const allQueries = parseQueriesJsonl(readFileSync(queriesPath, "utf8"), queriesPath);
  const rawQrels = parseQrelsTsv(readFileSync(qrelsPath, "utf8"), qrelsPath);

  const documentIds = new Set(allDocuments.map((doc) => doc.documentId));

  // Drop qrels naming a document the corpus file does not contain. Counted and
  // reported rather than ignored: each one shrinks the recall denominator, and
  // a large count means the corpus and the qrels came from different releases
  // of the dataset — which would make every number quietly wrong.
  let danglingQrels = 0;
  const qrels = new Map<string, Map<string, number>>();
  for (const [queryId, judged] of rawQrels) {
    const kept = new Map<string, number>();
    for (const [documentId, grade] of judged) {
      if (documentIds.has(documentId)) kept.set(documentId, grade);
      else danglingQrels++;
    }
    if (kept.size > 0) qrels.set(queryId, kept);
  }

  // A query with no judgements cannot be scored. Including it would contribute
  // an empty ideal ranking and drag every average toward zero.
  const judged = allQueries.filter((query) => (qrels.get(query.id)?.size ?? 0) > 0);
  if (judged.length === 0) {
    throw new Error(
      `No query in ${queriesPath} has a judgement in the ${options.split} split. The queries and ` +
        `qrels files do not line up — check they came from the same dataset release.`,
    );
  }

  const random = mulberry32(options.seed);
  const queries =
    options.maxQueries !== undefined && options.maxQueries < judged.length
      ? shuffled(judged, random)
          .slice(0, options.maxQueries)
          .sort((a, b) => a.id.localeCompare(b.id))
      : judged;

  const selectedQrels = new Map(queries.map((query) => [query.id, qrels.get(query.id)!]));

  // --- Document selection ---------------------------------------------------
  let documents = allDocuments;
  let pooledCorpus = false;

  if (options.maxDocuments !== undefined && options.maxDocuments < allDocuments.length) {
    const required = new Set<string>();
    for (const judgedDocs of selectedQrels.values()) {
      for (const documentId of judgedDocs.keys()) required.add(documentId);
    }
    if (required.size > options.maxDocuments) {
      throw new Error(
        `--max-docs ${options.maxDocuments} is below the ${required.size} documents the selected ` +
          `${queries.length} queries are judged against. Dropping a judged document deletes ground ` +
          `truth and would silently understate recall, so this is refused rather than truncated. ` +
          `Raise --max-docs to at least ${required.size}, or lower --queries.`,
      );
    }

    const distractors = shuffled(
      allDocuments.filter((doc) => !required.has(doc.documentId)),
      random,
    ).slice(0, options.maxDocuments - required.size);

    const keep = new Set([...required, ...distractors.map((doc) => doc.documentId)]);
    documents = allDocuments.filter((doc) => keep.has(doc.documentId));
    pooledCorpus = true;
  }

  return {
    name: options.name,
    split: options.split,
    dir,
    documents,
    queries,
    titles,
    qrels: selectedQrels,
    fingerprint: fingerprintBeirCorpus(options.name, options.split, documents),
    sampling: {
      queriesAvailable: judged.length,
      queriesUsed: queries.length,
      documentsAvailable: allDocuments.length,
      documentsUsed: documents.length,
      seed: options.seed,
      pooledCorpus,
      danglingQrels,
    },
    totalChars: documents.reduce((sum, doc) => sum + doc.totalChars, 0),
  };
}

/**
 * Content fingerprint of the exact document set that will be indexed.
 *
 * Hashes the ids AND the text, so both a different sample and an edited corpus
 * file produce a different namespace. Without the text, re-downloading a
 * corrected release of a dataset would silently reuse the vectors built from
 * the old one and report numbers for a corpus that no longer exists.
 */
export function fingerprintBeirCorpus(
  name: string,
  split: BeirSplit,
  documents: readonly CorpusDocument[],
): string {
  const hash = createHash("sha256");
  hash.update(`beir ${name} ${split} ${documents.length} `);
  for (const doc of documents) {
    hash.update(doc.documentId);
    hash.update(" ");
    hash.update(String(doc.totalChars));
    hash.update(" ");
    hash.update(createHash("sha256").update(doc.pages[0]?.text ?? "").digest());
  }
  return hash.digest("hex").slice(0, 10);
}

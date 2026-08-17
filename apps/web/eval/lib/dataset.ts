import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATASETS_DIR } from "../config";
import type { CorpusDocument } from "./corpus";
import { byDocumentId, pageTextOf } from "./corpus";
import {
  datasetManifestSchema,
  goldenItemSchema,
  goldenSpans,
  type DatasetManifest,
  type GoldenItem,
} from "./types";

/**
 * Reading and writing golden datasets.
 *
 * JSONL, one item per line, committed to the repo: a run is only reproducible
 * if the questions are, and a line-per-item file diffs readably when someone
 * curates it. Every read is validated — a dataset outlives the code that wrote
 * it, and a malformed span produces wrong metrics rather than an error.
 */

export interface LoadedDataset {
  name: string;
  items: GoldenItem[];
  manifest: DatasetManifest | null;
}

const datasetPath = (name: string) => resolve(DATASETS_DIR, `${name}.jsonl`);
const manifestPath = (name: string) => resolve(DATASETS_DIR, `${name}.meta.json`);
export const reviewQueuePath = (name: string) => resolve(DATASETS_DIR, `${name}.review.jsonl`);

/** Parse JSONL, reporting the line number of the first bad row. */
function parseJsonl<T>(contents: string, parse: (value: unknown) => T, source: string): T[] {
  const items: T[] = [];
  const lines = contents.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      items.push(parse(JSON.parse(line)));
    } catch (err) {
      throw new Error(
        `${source}:${i + 1} is not a valid item — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return items;
}

/** Serialize items as JSONL with a trailing newline. */
export function writeJsonl(path: string, items: unknown[]): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, items.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
}

/** Load a dataset and its manifest. The manifest is optional but expected. */
export function loadDataset(name: string): LoadedDataset {
  const path = datasetPath(name);
  if (!existsSync(path)) {
    throw new Error(
      `Dataset "${name}" not found at ${path}. Build one with \`pnpm eval:gen\` or hand-write it — see eval/README.md.`,
    );
  }

  const items = parseJsonl(
    readFileSync(path, "utf8"),
    (value) => goldenItemSchema.parse(value),
    path,
  );
  if (items.length === 0) throw new Error(`Dataset "${name}" is empty.`);

  const duplicates = items
    .map((item) => item.id)
    .filter((id, i, all) => all.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(`Dataset "${name}" has duplicate item ids: ${[...new Set(duplicates)].join(", ")}`);
  }

  const metaPath = manifestPath(name);
  const manifest = existsSync(metaPath)
    ? datasetManifestSchema.parse(JSON.parse(readFileSync(metaPath, "utf8")))
    : null;

  return { name, items, manifest };
}

export function writeDataset(name: string, items: GoldenItem[], manifest: DatasetManifest): void {
  writeJsonl(datasetPath(name), items);
  mkdirSync(DATASETS_DIR, { recursive: true });
  writeFileSync(manifestPath(name), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * Check every golden span against the corpus it claims to come from.
 *
 * This runs before a single embedding is bought. A span pointing past the end
 * of its document, or at a page that does not exist, yields a question no chunk
 * can ever satisfy — which shows up as a plausible-looking recall drop rather
 * than as an error, and would be blamed on the retrieval config being measured.
 */
export function validateAgainstCorpus(
  items: GoldenItem[],
  documents: CorpusDocument[],
): string[] {
  const docs = byDocumentId(documents);
  const problems: string[] = [];

  for (const item of items) {
    const doc = docs.get(item.documentId);
    if (!doc) {
      problems.push(
        `${item.id}: document "${item.documentId}" is not in the corpus (have: ${[...docs.keys()].join(", ")})`,
      );
      continue;
    }
    for (const span of goldenSpans(item)) {
      const text = pageTextOf(doc, span.page);
      if (text === undefined) {
        problems.push(`${item.id}: page ${span.page ?? "(unpaged)"} does not exist in ${item.documentId}`);
        continue;
      }
      if (span.endChar > text.length) {
        problems.push(
          `${item.id}: span ends at ${span.endChar} but ${item.documentId} page ${span.page ?? "(unpaged)"} is ${text.length} chars`,
        );
      }
      if (text.slice(span.startChar, span.endChar).trim().length === 0) {
        problems.push(`${item.id}: span [${span.startChar}, ${span.endChar}) is empty or whitespace`);
      }
    }
  }
  return problems;
}

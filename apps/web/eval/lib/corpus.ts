import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { CORPUS_DIR } from "../config";
import { extractPages, type PageText } from "../../src/server/lib/extract";

/**
 * Loading the reference corpus.
 *
 * Text extraction goes through the production `extractPages`, not a local
 * reader, so the page splitting and PDF handling being evaluated is the same
 * code that runs at ingestion. A corpus document is identified by its filename
 * stem, so `rag-primer.md` is `documentId: "rag-primer"` in every dataset — the
 * harness never reads a tenant document or touches the database.
 */

export interface CorpusDocument {
  /** Filename stem — how datasets refer to this document. */
  documentId: string;
  filename: string;
  /** Extracted text, one entry per page (a single unpaged entry for txt/md). */
  pages: PageText[];
  /** Total characters across pages, for cost estimation. */
  totalChars: number;
}

const CONTENT_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
};

/** Load every supported document in a corpus directory, sorted by id. */
export async function loadCorpus(dir: string = CORPUS_DIR): Promise<CorpusDocument[]> {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && extname(e.name).toLowerCase() in CONTENT_TYPES)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) {
    throw new Error(
      `No corpus documents found in ${dir}. Supported extensions: ${Object.keys(CONTENT_TYPES).join(", ")}`,
    );
  }

  const documents: CorpusDocument[] = [];
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    const bytes = readFileSync(path);
    const contentType = CONTENT_TYPES[extname(entry.name).toLowerCase()];
    // `extractPages` takes an ArrayBuffer; slice to the exact view since a Node
    // Buffer can be a window onto a larger pooled allocation.
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

    const pages = await extractPages(buffer, contentType);
    documents.push({
      documentId: basename(entry.name, extname(entry.name)),
      filename: entry.name,
      pages,
      totalChars: pages.reduce((sum, p) => sum + p.text.length, 0),
    });
  }
  return documents;
}

/** Index a corpus by document id for lookups while scoring. */
export function byDocumentId(documents: CorpusDocument[]): Map<string, CorpusDocument> {
  return new Map(documents.map((doc) => [doc.documentId, doc]));
}

/** The page text a span refers to, or undefined if the page does not exist. */
export function pageTextOf(doc: CorpusDocument, page: number | null | undefined): string | undefined {
  const wanted = page ?? null;
  return doc.pages.find((p) => (p.page ?? null) === wanted)?.text;
}

/**
 * A short, readable excerpt of a span — what the report shows so a failure can
 * be understood without opening the source file.
 */
export function excerptSpan(
  doc: CorpusDocument,
  span: { startChar: number; endChar: number; page?: number | null },
  maxChars = 300,
): string {
  const text = pageTextOf(doc, span.page);
  if (text === undefined) return "";
  const excerpt = text.slice(span.startChar, span.endChar);
  return excerpt.length > maxChars ? `${excerpt.slice(0, maxChars)}…` : excerpt;
}

import { extractText, getDocumentProxy } from "unpdf";
import { PermanentError } from "./errors";

/**
 * Plain-text extraction for the supported upload types.
 *
 * PDFs go through `unpdf` (a serverless build of Mozilla's PDF.js, made for
 * Workers-like runtimes) and keep per-page text so chunks — and later,
 * citations — can reference page numbers. txt/markdown decode directly and
 * carry no page information.
 */

export interface PageText {
  /** 1-based page number for paged sources (PDF); null for txt/markdown. */
  page: number | null;
  text: string;
}

export async function extractPages(
  buffer: ArrayBuffer,
  contentType: string,
): Promise<PageText[]> {
  if (contentType === "application/pdf") {
    let texts: string[];
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      ({ text: texts } = await extractText(pdf, { mergePages: false }));
    } catch (err) {
      // A file PDF.js cannot parse will never parse — fail fast.
      throw new PermanentError(
        `Could not parse PDF: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return texts.map((text, i) => ({ page: i + 1, text }));
  }

  // text/plain, text/markdown — decode leniently (invalid bytes → U+FFFD).
  return [{ page: null, text: new TextDecoder("utf-8").decode(buffer) }];
}

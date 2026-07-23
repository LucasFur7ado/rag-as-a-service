import type { Citation } from "@rag/shared";
import { CITATION_SNIPPET_MAX_CHARS } from "../config";
import type { ContextSource } from "./context";

/**
 * Citation resolution: map the `[n]` markers the model emitted back to the
 * real retrieved chunks, and flag any markers that don't correspond to one
 * (hallucinated citations). Pure function — testable without a model.
 */

export interface ResolvedCitations {
  /** Every context source in marker order, with `cited` reflecting the answer. */
  sources: Citation[];
  /** Markers emitted by the model with no matching source, ascending. */
  invalidMarkers: number[];
}

/** Matches [3] and grouped forms like [1, 2] / [1][2]. */
const MARKER_PATTERN = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

export function resolveCitations(
  answer: string,
  sources: ContextSource[],
): ResolvedCitations {
  const emitted = new Set<number>();
  for (const match of answer.matchAll(MARKER_PATTERN)) {
    for (const part of match[1].split(",")) emitted.add(Number(part.trim()));
  }

  const valid = new Set(sources.map((s) => s.marker));
  const invalidMarkers = [...emitted]
    .filter((marker) => !valid.has(marker))
    .sort((a, b) => a - b);

  return {
    sources: sources.map((source) => ({
      marker: source.marker,
      documentId: source.documentId,
      filename: source.filename,
      page: source.page,
      chunkIndex: source.chunkIndex,
      snippet: source.text.slice(0, CITATION_SNIPPET_MAX_CHARS),
      score: source.score,
      cited: emitted.has(source.marker),
    })),
    invalidMarkers,
  };
}

import type { QueryJudgement } from "../metrics";

/**
 * Judging a BEIR query: the part with no equivalent in the span-based harness.
 *
 * The custom golden set asks "does this chunk overlap the passage that answers
 * the question?". BEIR cannot ask that — its answer key names whole documents
 * and knows nothing about offsets. So the judgement here happens one level up:
 *
 *   1. Retrieval returns a ranking of CHUNKS.
 *   2. That ranking is folded into a ranking of DOCUMENTS (a document enters at
 *      the rank of its best-scoring chunk).
 *   3. The document ranking is scored against the qrels, using the qrel grade
 *      as the relevance gain.
 *
 * Step 2 is the load-bearing one, and it is what makes a chunked RAG system
 * measurable on a document-level benchmark at all. Scoring the chunk ranking
 * directly against document-level qrels would be a different, worse question:
 * a query whose one relevant document produced five retrieved chunks would look
 * like five successes, and precision@k would reward returning the same document
 * over and over.
 *
 * Pure functions, unit-tested in judge.test.ts, for the same reason the metric
 * math is: a mistake here does not throw, it reports a plausible number.
 */

/** One retrieved chunk, reduced to what the fold needs. */
export interface RetrievedChunkRef {
  /** Vector id, kept only so a failure record can name the chunk. */
  chunkId: string;
  documentId: string;
  score: number;
}

/** A document in the folded ranking. */
export interface RankedDocument {
  /** 1-based position in the document ranking — what the metrics see. */
  rank: number;
  documentId: string;
  /** Score of this document's best chunk. */
  score: number;
  /** 1-based position of that chunk in the chunk ranking, before folding. */
  chunkRank: number;
  chunkId: string;
  /** How many of the retrieved chunks belong to this document. */
  chunkCount: number;
}

/**
 * Fold a chunk ranking into a document ranking.
 *
 * A document enters at its best chunk's position and appears exactly once. The
 * input is sorted by score before folding rather than trusted to arrive sorted:
 * the provider does return matches in descending score order, but "best chunk
 * wins" is the definition of this function, not an assumption it makes about
 * Pinecone's response ordering.
 *
 * Ties are broken by the chunk's original position, so the fold is stable and
 * two runs over identical scores produce identical rankings.
 */
export function foldToDocuments(chunks: readonly RetrievedChunkRef[]): RankedDocument[] {
  const ordered = chunks
    .map((chunk, index) => ({ chunk, index }))
    .sort((a, b) => b.chunk.score - a.chunk.score || a.index - b.index);

  const byDocument = new Map<string, RankedDocument>();
  for (const [position, { chunk }] of ordered.entries()) {
    const existing = byDocument.get(chunk.documentId);
    if (existing) {
      existing.chunkCount++;
      continue;
    }
    byDocument.set(chunk.documentId, {
      // Placeholder: the true rank is only known once every document is in.
      rank: 0,
      documentId: chunk.documentId,
      score: chunk.score,
      chunkRank: position + 1,
      chunkId: chunk.chunkId,
      chunkCount: 1,
    });
  }

  const documents = [...byDocument.values()];
  for (const [index, document] of documents.entries()) document.rank = index + 1;
  return documents;
}

/**
 * Score a document ranking against a query's judgements.
 *
 * `gains` is the qrel grade at each rank (0 for an unjudged document, which
 * TREC treats as not relevant); `idealGains` is every positive grade the query
 * has, whether or not it was retrieved. Feeding those into the shared
 * `aggregate()` gives hit rate, precision, recall and NDCG that mean the same
 * thing here as they do for the custom dataset — the only difference is that
 * the unit being counted is a document rather than a chunk.
 */
export function judgeDocumentRanking(
  documents: readonly RankedDocument[],
  qrels: ReadonlyMap<string, number> | undefined,
): QueryJudgement {
  const judged = qrels ?? new Map<string, number>();
  return {
    gains: documents.map((document) => Math.max(0, judged.get(document.documentId) ?? 0)),
    idealGains: [...judged.values()].filter((grade) => grade > 0),
  };
}

/** Documents the answer key names that never appeared in the ranking. */
export function missedDocuments(
  documents: readonly RankedDocument[],
  qrels: ReadonlyMap<string, number> | undefined,
): { documentId: string; grade: number }[] {
  const retrieved = new Set(documents.map((document) => document.documentId));
  return [...(qrels ?? new Map<string, number>())]
    .filter(([documentId, grade]) => grade > 0 && !retrieved.has(documentId))
    .map(([documentId, grade]) => ({ documentId, grade }))
    // Highest-graded misses first: a missed grade-2 document is a worse failure
    // than a missed grade-1 one, and is what someone reading the file wants.
    .sort((a, b) => b.grade - a.grade || a.documentId.localeCompare(b.documentId));
}

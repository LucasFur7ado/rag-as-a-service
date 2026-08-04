import {
  CONTEXT_TOKEN_BUDGET,
  NEAR_DUPLICATE_JACCARD,
  SIMILARITY_THRESHOLD,
} from "../config";
import { countTokens } from "../lib/tokens";
import type { RetrievedChunk } from "./retrieval";

/**
 * Context assembly stage: retrieved chunks → the prompt block the model sees.
 *
 * Steps (in order): similarity threshold → near-duplicate removal → token
 * budget → citation-marker assignment → "lost in the middle" ordering →
 * rendering. Pure functions over in-memory data; no I/O.
 *
 * // TODO (next): re-ranking — a cross-encoder re-ranker slots in BEFORE this
 * // module (between retrieval and assembleContext), re-scoring the top-k so
 * // the threshold/budget below operate on better scores.
 */

/** A chunk that made it into the context, labeled with its citation marker. */
export interface ContextSource extends RetrievedChunk {
  /** 1-based marker the model cites with, ordered by relevance (1 = best). */
  marker: number;
}

export interface AssembledContext {
  /** Sources in marker order (1..n). Empty when nothing cleared the filters. */
  sources: ContextSource[];
  /** The rendered context block for the user prompt. */
  contextText: string;
  /** Tokens in `contextText` (counts against CONTEXT_TOKEN_BUDGET). */
  contextTokens: number;
}

export interface AssembleOptions {
  similarityThreshold?: number;
  tokenBudget?: number;
  nearDuplicateJaccard?: number;
}

/**
 * Turn raw retrieval matches into a bounded, deduplicated, well-ordered
 * context block plus the marker→source mapping needed for citations.
 */
export function assembleContext(
  chunks: RetrievedChunk[],
  {
    similarityThreshold = SIMILARITY_THRESHOLD,
    tokenBudget = CONTEXT_TOKEN_BUDGET,
    nearDuplicateJaccard = NEAR_DUPLICATE_JACCARD,
  }: AssembleOptions = {},
): AssembledContext {
  // Work in relevance order throughout — every later step keeps "best first".
  const ranked = [...chunks].sort((a, b) => b.score - a.score);

  const relevant = ranked.filter((c) => c.score >= similarityThreshold);
  const unique = dropNearDuplicates(relevant, nearDuplicateJaccard);
  const budgeted = fitTokenBudget(unique, tokenBudget);

  // Markers are assigned by relevance rank (1 = most relevant) BEFORE the
  // lost-in-the-middle reordering, so marker numbers are meaningful to users
  // and stable regardless of prompt position.
  const sources: ContextSource[] = budgeted.map((chunk, i) => ({
    ...chunk,
    marker: i + 1,
  }));

  const ordered = orderForContextWindow(sources);
  const contextText = ordered.map(renderChunk).join("\n\n");

  return {
    sources,
    contextText,
    contextTokens: contextText ? countTokens(contextText) : 0,
  };
}

/**
 * Remove near-identical chunks, keeping the higher-scoring one (input must be
 * sorted by score desc). Two chunks are near-duplicates when one's normalized
 * text contains the other (chunk-overlap tails, re-uploaded files) or their
 * word-trigram Jaccard similarity exceeds the threshold.
 */
function dropNearDuplicates(
  chunks: RetrievedChunk[],
  jaccardThreshold: number,
): RetrievedChunk[] {
  const kept: { chunk: RetrievedChunk; norm: string; trigrams: Set<string> }[] =
    [];
  for (const chunk of chunks) {
    const norm = normalize(chunk.text);
    const trigrams = wordTrigrams(norm);
    const isDuplicate = kept.some(
      (k) =>
        k.norm.includes(norm) ||
        norm.includes(k.norm) ||
        jaccard(k.trigrams, trigrams) >= jaccardThreshold,
    );
    if (!isDuplicate) kept.push({ chunk, norm, trigrams });
  }
  return kept.map((k) => k.chunk);
}

/**
 * Keep the highest-scoring prefix of chunks whose rendered form fits the
 * token budget (input sorted by score desc ⇒ lowest-scoring are dropped
 * first). Tokens are counted on the rendered chunk (label included) so the
 * budget matches what the model actually receives.
 */
function fitTokenBudget(
  chunks: RetrievedChunk[],
  budget: number,
): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];
  let used = 0;
  for (const chunk of chunks) {
    // +2 approximates the "\n\n" joiner between rendered chunks.
    const cost = countTokens(renderChunk({ ...chunk, marker: kept.length + 1 })) + 2;
    if (used + cost > budget) break;
    kept.push(chunk);
    used += cost;
  }
  return kept;
}

/**
 * Mitigate the "lost in the middle" effect: LLMs attend most reliably to the
 * beginning and end of a long context, so the best chunks must not be buried
 * mid-prompt. Given sources ranked best-first, alternate placement between
 * the front and the back of the window: rank 1 → first, rank 2 → last,
 * rank 3 → second, rank 4 → second-to-last, ... leaving the weakest chunks
 * in the middle.
 */
export function orderForContextWindow(sources: ContextSource[]): ContextSource[] {
  const front: ContextSource[] = [];
  const back: ContextSource[] = [];
  sources.forEach((source, i) => {
    if (i % 2 === 0) front.push(source);
    else back.unshift(source);
  });
  return [...front, ...back];
}

/** Render one chunk as it appears in the prompt, labeled with its marker. */
function renderChunk(source: ContextSource): string {
  const origin =
    source.page !== null
      ? `${source.filename}, page ${source.page}`
      : source.filename;
  return `[${source.marker}] (${origin})\n${source.text}`;
}

/** Lowercase + collapse whitespace so trivial formatting differences vanish. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Set of consecutive 3-word shingles; robust cheap similarity signature. */
function wordTrigrams(normalizedText: string): Set<string> {
  const words = normalizedText.split(" ");
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= words.length; i++) {
    grams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  // Very short chunks: fall back to the whole text as one shingle.
  if (grams.size === 0 && normalizedText) grams.add(normalizedText);
  return grams;
}

/** Jaccard similarity |A∩B| / |A∪B| of two shingle sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

import { z } from "zod";
import { DEFAULT_OVERLAP_RULE, type OverlapRule } from "../config";

/**
 * The harness's data model: golden datasets, experiments, and run results.
 *
 * Zod is the source of truth here for the same reason it is in
 * packages/shared: a dataset is a committed file that outlives the code that
 * wrote it, and a silently malformed span would not crash anything — it would
 * just make every metric slightly wrong.
 */

// --- Golden dataset ---------------------------------------------------------

/**
 * A span of a source document, in characters.
 *
 * Offsets index the *page text* the document extracts to — per page for PDFs,
 * the whole file for txt/markdown (which extract as a single unpaged entry) —
 * matching what `chunkPages` records on every chunk. `page` therefore has to
 * match for a comparison to mean anything, and null is a real value, not
 * "unknown".
 */
export const sourceSpanSchema = z
  .object({
    startChar: z.number().int().min(0),
    endChar: z.number().int().min(0),
    page: z.number().int().min(1).nullable().optional(),
  })
  .refine((s) => s.endChar > s.startChar, {
    message: "endChar must be greater than startChar",
  });

export type SourceSpan = z.infer<typeof sourceSpanSchema>;

export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof difficultySchema>;

/**
 * One evaluation item: a question, and where in the corpus its answer lives.
 *
 * `documentId` is the corpus document's stem (`rag-primer.md` → `rag-primer`),
 * not a database id — the harness never touches tenant data.
 */
export const goldenItemSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  documentId: z.string().min(1),
  sourceSpan: sourceSpanSchema,
  /**
   * Additional spans that also answer the question. Optional, and the reason
   * NDCG can be graded: an item with several supporting spans rewards a ranking
   * that surfaces more of them.
   */
  extraSpans: z.array(sourceSpanSchema).optional(),
  /** The answer text, for human review. Never used in scoring. */
  answerText: z.string().optional(),
  difficulty: difficultySchema.optional(),
  tags: z.array(z.string()).optional(),
});

export type GoldenItem = z.infer<typeof goldenItemSchema>;

/** Every span an item accepts as ground truth, primary first. */
export function goldenSpans(item: GoldenItem): SourceSpan[] {
  return [item.sourceSpan, ...(item.extraSpans ?? [])];
}

/** Provenance for a dataset — how it was built, and how much to trust it. */
export const datasetManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  itemCount: z.number().int().min(0),
  createdAt: z.string(),
  corpus: z.string(),
  /** "manual", "synthetic", or "mixed" — surfaced as a caveat in the report. */
  provenance: z.enum(["manual", "synthetic", "mixed"]),
  /** Model that generated the questions, when any were generated. */
  generatorModel: z.string().nullable().optional(),
  /** Whether a human curated the generated items. Synthetic-only sets are weak. */
  humanReviewed: z.boolean(),
  notes: z.string().optional(),
});

export type DatasetManifest = z.infer<typeof datasetManifestSchema>;

/** A row in a `*.review.jsonl` queue: a candidate plus why it might be bad. */
export const reviewCandidateSchema = goldenItemSchema.extend({
  review: z.object({
    /** Jaccard overlap between the question and its source passage. */
    questionPassageJaccard: z.number(),
    /** Warnings that did not disqualify the item but deserve a human look. */
    flags: z.array(z.string()),
    passageText: z.string(),
  }),
});

export type ReviewCandidate = z.infer<typeof reviewCandidateSchema>;

// --- Experiments ------------------------------------------------------------

export interface ChunkingConfig {
  /**
   * Only "recursive" is implemented — it is what `lib/chunking.ts` does. The
   * field exists so a second strategy is a config change rather than a schema
   * change.
   */
  strategy: "recursive";
  sizeChars: number;
  overlapChars: number;
}

export interface RetrievalConfig {
  topK: number;
  /**
   * `dense` is the production path. `hybrid` is NOT implemented: the Workers AI
   * REST endpoint for bge-m3 returns dense vectors only, so no sparse weights
   * exist to fuse. The value is accepted and validated so the ablation is a
   * one-line change the day sparse vectors become available; running it today
   * fails immediately with an explanation rather than silently measuring dense.
   */
  mode: "dense" | "hybrid";
  /** Fusion method for `hybrid`. Unused until hybrid exists. */
  fusion?: "rrf";
  /**
   * Reported alongside the metrics and used for the "survives the threshold"
   * column: a chunk retrieved below this score never reaches the context in
   * production, so recall above it overstates what the user would actually get.
   */
  similarityThreshold: number;
  /**
   * Re-ranking toggle. Wired through to a no-op today.
   * // TODO: re-ranking — when a cross-encoder re-ranker lands between
   * // retrieval and context assembly, apply it here so an experiment can
   * // measure it against the same dataset with everything else fixed.
   */
  rerank: boolean;
}

export interface Experiment {
  /** Filled in from the filename by the loader; do not set it by hand. */
  name?: string;
  description: string;
  /** Dataset stem under eval/datasets. */
  dataset: string;
  /** Embedding model id. Must match the Pinecone index dimension. */
  embeddingModel: string;
  chunking: ChunkingConfig;
  retrieval: RetrievalConfig;
  /** Overrides for the relevance rule; defaults to DEFAULT_OVERLAP_RULE. */
  relevance?: Partial<OverlapRule>;
}

/** An experiment with every optional field resolved. */
export interface ResolvedExperiment extends Omit<Experiment, "name" | "relevance"> {
  name: string;
  relevance: OverlapRule;
}

export function resolveExperiment(name: string, experiment: Experiment): ResolvedExperiment {
  return {
    ...experiment,
    name,
    relevance: { ...DEFAULT_OVERLAP_RULE, ...(experiment.relevance ?? {}) },
  };
}

// --- Results ----------------------------------------------------------------

/** One retrieved chunk, as scored against a golden item. */
export interface ScoredResult {
  rank: number;
  chunkId: string;
  documentId: string;
  page: number | null;
  startChar: number | null;
  endChar: number | null;
  score: number;
  text: string;
  relevant: boolean;
  /** How many golden spans this chunk overlaps — the graded NDCG gain. */
  gain: number;
}

/** Everything the harness learned about one question under one experiment. */
export interface QueryOutcome {
  item: GoldenItem;
  results: ScoredResult[];
  /** 1-based rank of the first relevant result; null if none was retrieved. */
  firstRelevantRank: number | null;
  /** Chunks in the index that overlap a golden span — the recall denominator. */
  relevantChunkIds: string[];
  embedMs: number;
  retrievalMs: number;
}

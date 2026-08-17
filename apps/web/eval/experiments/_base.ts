import {
  CHUNK_OVERLAP_CHARS,
  CHUNK_SIZE_CHARS,
  EMBEDDING_MODEL,
  SIMILARITY_THRESHOLD,
  TOP_K,
} from "../../src/server/config";
import type { Experiment } from "../lib/types";

/**
 * Shared defaults for the starter experiments.
 *
 * Every value here is imported from src/server/config.ts rather than copied, so
 * "the baseline" always means "what the product actually does today". If
 * someone tunes CHUNK_SIZE_CHARS in the app, the next evaluation run compares
 * against the new value automatically instead of silently benchmarking a
 * configuration that no longer ships.
 *
 * Files starting with `_` are helpers and are not listed as runnable
 * experiments.
 */

/** The dataset every starter experiment scores against. */
export const DEFAULT_DATASET = "starter";

export const PRODUCTION_DEFAULTS = {
  chunkSizeChars: CHUNK_SIZE_CHARS,
  chunkOverlapChars: CHUNK_OVERLAP_CHARS,
  topK: TOP_K,
  similarityThreshold: SIMILARITY_THRESHOLD,
  embeddingModel: EMBEDDING_MODEL,
} as const;

/** Build an experiment from the production defaults plus a few overrides. */
export function experiment(
  description: string,
  overrides: {
    chunkSizeChars?: number;
    chunkOverlapChars?: number;
    topK?: number;
    dataset?: string;
    mode?: "dense" | "hybrid";
    rerank?: boolean;
  } = {},
): Experiment {
  return {
    description,
    dataset: overrides.dataset ?? DEFAULT_DATASET,
    embeddingModel: PRODUCTION_DEFAULTS.embeddingModel,
    chunking: {
      strategy: "recursive",
      sizeChars: overrides.chunkSizeChars ?? PRODUCTION_DEFAULTS.chunkSizeChars,
      overlapChars: overrides.chunkOverlapChars ?? PRODUCTION_DEFAULTS.chunkOverlapChars,
    },
    retrieval: {
      topK: overrides.topK ?? PRODUCTION_DEFAULTS.topK,
      mode: overrides.mode ?? "dense",
      similarityThreshold: PRODUCTION_DEFAULTS.similarityThreshold,
      rerank: overrides.rerank ?? false,
    },
  };
}

/** 15% of the chunk size, the ratio the product ships. */
export function overlapFor(sizeChars: number, ratio = 0.15): number {
  return Math.round(sizeChars * ratio);
}

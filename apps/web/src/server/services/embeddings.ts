import "server-only";

import {
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
  MAX_EMBED_BATCH_SIZE,
} from "../config";
import { PermanentError } from "../lib/errors";
import { geminiJson } from "./gemini";

/**
 * Embedding provider seam.
 *
 * Concrete implementations (Gemini, OpenAI, Cohere, ...) plug in here so the
 * rest of the app depends only on this interface.
 */

/**
 * What the embedding is *for*. Gemini embeds asymmetrically: a passage being
 * indexed and a question being asked about it are encoded with different task
 * types, which measurably improves retrieval over embedding both identically.
 * This is a genuine capability the previous BGE-M3 provider did not expose
 * (BGE-M3 is symmetric and takes no prefix), so it is part of the seam.
 */
export type EmbeddingTask = "document" | "query";

export interface EmbedResult {
  /** One vector per input, in the same order. */
  vectors: number[][];
  /** Model identifier that produced the vectors. */
  model: string;
}

export interface EmbeddingProvider {
  /** Dimensionality of the vectors this provider returns. */
  readonly dimension: number;
  /** Max inputs accepted per `embed` call. */
  readonly maxBatchSize: number;
  /** Embed a batch of texts for the given task. */
  embed(texts: string[], task: EmbeddingTask): Promise<EmbedResult>;
}

const TASK_TYPES: Record<EmbeddingTask, string> = {
  document: "RETRIEVAL_DOCUMENT",
  query: "RETRIEVAL_QUERY",
};

interface BatchEmbedResponse {
  embeddings?: { values?: number[] }[];
}

/**
 * Gemini embeddings over the REST API.
 *
 * `outputDimensionality` is the load-bearing option: the model natively emits
 * 3072-dim vectors, but it was trained with Matryoshka representation learning,
 * so a truncated prefix is still a valid embedding. Requesting 1024 is what
 * lets the existing Pinecone index (dimension 1024, cosine) be reused as-is.
 *
 * Truncated vectors are NOT unit-length as returned, so we re-normalize. Cosine
 * similarity is scale-invariant and would be unaffected either way, but every
 * downstream threshold (SIMILARITY_THRESHOLD) is expressed in cosine terms and
 * normalizing keeps the stored vectors consistent with that assumption — and
 * with anything that later switches the index to a dot-product metric.
 *
 * // TODO: hybrid search — Gemini exposes dense vectors only, so no sparse /
 * // lexical weights are stored at ingestion and there is nothing to fuse.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = EMBEDDING_DIMENSION;
  readonly maxBatchSize = MAX_EMBED_BATCH_SIZE;

  async embed(texts: string[], task: EmbeddingTask): Promise<EmbedResult> {
    if (texts.length === 0) return { vectors: [], model: EMBEDDING_MODEL };
    if (texts.length > this.maxBatchSize) {
      // Callers batch; exceeding the provider limit is a programming error.
      throw new PermanentError(
        `Embedding batch of ${texts.length} exceeds the Gemini limit of ${this.maxBatchSize} inputs per request`,
      );
    }

    const model = `models/${EMBEDDING_MODEL}`;
    const body = await geminiJson<BatchEmbedResponse>(
      `/${model}:batchEmbedContents`,
      {
        requests: texts.map((text) => ({
          model,
          content: { parts: [{ text }] },
          taskType: TASK_TYPES[task],
          outputDimensionality: this.dimension,
        })),
      },
    );

    const data = body.embeddings;
    if (!data || data.length !== texts.length) {
      throw new Error(
        `Gemini returned ${data?.length ?? 0} embeddings for ${texts.length} inputs`,
      );
    }

    const vectors = data.map((entry, i) => {
      const values = entry.values;
      if (!values || values.length !== this.dimension) {
        // A model/config mismatch is deterministic — fail fast, loudly.
        throw new PermanentError(
          `Embedding dimension mismatch: ${EMBEDDING_MODEL} returned ${values?.length ?? 0}-dim vectors for input ${i} but EMBEDDING_DIMENSION is ${this.dimension}`,
        );
      }
      return normalize(values);
    });

    return { vectors, model: EMBEDDING_MODEL };
  }
}

/** Scale a vector to unit length. A zero vector is returned unchanged. */
function normalize(values: number[]): number[] {
  let sumSquares = 0;
  for (const v of values) sumSquares += v * v;
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) return values;
  return values.map((v) => v / magnitude);
}

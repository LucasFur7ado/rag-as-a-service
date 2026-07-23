import {
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
  MAX_EMBED_BATCH_SIZE,
} from "../config";
import { PermanentError } from "../lib/errors";

/**
 * Embedding provider seam.
 *
 * Concrete implementations (Workers AI, OpenAI, Cohere, ...) plug in here so
 * the rest of the app depends only on this interface.
 */

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
  /** Embed a batch of texts. */
  embed(texts: string[]): Promise<EmbedResult>;
}

/**
 * Workers AI embeddings via the `AI` binding, using BGE-M3 (multilingual,
 * 1024-dim dense vectors).
 *
 * Note: the Workers AI binding for bge-m3 returns dense embeddings only
 * (`{ data: number[][] }`) — it does not expose the model's sparse/lexical
 * weights, so hybrid search is not possible from this provider today.
 * // TODO (Feature 3): hybrid search — sparse vectors (not exposed by the
 * // Workers AI bge-m3 binding as of 2026-07; re-check the model schema).
 */
export class WorkersAiEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = EMBEDDING_DIMENSION;
  readonly maxBatchSize = MAX_EMBED_BATCH_SIZE;

  constructor(private readonly ai: Ai) {}

  async embed(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) return { vectors: [], model: EMBEDDING_MODEL };
    if (texts.length > this.maxBatchSize) {
      // Callers batch; exceeding the provider limit is a programming error.
      throw new PermanentError(
        `Embedding batch of ${texts.length} exceeds the Workers AI limit of ${this.maxBatchSize} inputs per request`,
      );
    }

    // `truncate_inputs` clips over-long inputs instead of erroring; chunks are
    // sized well below the model context, so this is a safety net only.
    const result = await this.ai.run(EMBEDDING_MODEL, {
      text: texts,
      truncate_inputs: true,
    });

    const data = "data" in result ? result.data : undefined;
    if (!data || data.length !== texts.length) {
      throw new Error(
        `Workers AI returned ${data?.length ?? 0} embeddings for ${texts.length} inputs`,
      );
    }
    for (const vector of data) {
      if (vector.length !== this.dimension) {
        // A model/config mismatch is deterministic — fail fast, loudly.
        throw new PermanentError(
          `Embedding dimension mismatch: ${EMBEDDING_MODEL} returned ${vector.length}-dim vectors but EMBEDDING_DIMENSION is ${this.dimension}`,
        );
      }
    }
    return { vectors: data, model: EMBEDDING_MODEL };
  }
}

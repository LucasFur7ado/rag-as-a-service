import "server-only";

import {
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
  MAX_EMBED_BATCH_SIZE,
} from "../config";
import { PermanentError } from "../lib/errors";
import { workersAiRun } from "./workersai";

/**
 * Embedding provider seam.
 *
 * Concrete implementations (Workers AI, Gemini, OpenAI, ...) plug in here so
 * the rest of the app depends only on this interface.
 *
 * Exactly ONE provider is wired up at a time, deliberately. Vectors from two
 * different models are not comparable, and this app writes them all into a
 * single Pinecone index — so a "pick your provider" switch would silently
 * corrupt retrieval for anything ingested before the switch. Changing provider
 * means re-ingesting every document.
 */

/**
 * What the embedding is *for*. Some models embed asymmetrically — a passage
 * being indexed and a question asked about it are encoded differently, which
 * improves retrieval over embedding both identically.
 *
 * BGE-M3 is symmetric and takes no prefix, so the current provider ignores
 * this. It stays in the seam because it is not recoverable after the fact: a
 * provider that does distinguish the two (Gemini's RETRIEVAL_DOCUMENT /
 * RETRIEVAL_QUERY task types) needs the caller to have said which it wanted.
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

/**
 * The embedding-shaped response of `@cf/baai/bge-m3`. The model also accepts a
 * `{ query, contexts }` reranking form that returns `{ response }` instead;
 * this provider only ever sends the `{ text }` form, so `data` is what comes
 * back. Shape mirrors `Ai_Cf_Baai_Bge_M3_Output_Embedding` in
 * @cloudflare/workers-types.
 */
interface BgeM3EmbeddingOutput {
  data?: number[][];
  shape?: number[];
  pooling?: "mean" | "cls";
}

/**
 * BGE-M3 embeddings via the Workers AI REST API.
 *
 * Chosen over a hosted commercial embedding API for the free allowance:
 * Workers AI grants 10,000 Neurons/day and bge-m3 costs 1,075 neurons per
 * million input tokens, i.e. ~9.3M input tokens/day at no cost — roughly 40k
 * chunks at CHUNK_SIZE_CHARS. Gemini's free embedding tier counts each *input*
 * of a batch against a 100-request quota, which a single full batch exhausts.
 *
 * 1024 dimensions is this model's NATIVE output, which is why the Pinecone
 * index has that dimension: it was created for bge-m3 originally. Nothing is
 * truncated or projected.
 *
 * Vectors are normalized defensively. bge-m3 already returns unit-length
 * vectors, so this is a no-op in practice — but it is cheap, idempotent, and
 * keeps stored vectors consistent with SIMILARITY_THRESHOLD being expressed in
 * cosine terms even if the pooling behaviour ever changes.
 *
 * // TODO: hybrid search — the Workers AI endpoint for bge-m3 returns dense
 * // embeddings only. The model itself produces sparse/lexical weights, but
 * // they are not exposed here, so there is nothing to fuse at query time.
 */
export class WorkersAiEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = EMBEDDING_DIMENSION;
  readonly maxBatchSize = MAX_EMBED_BATCH_SIZE;

  /**
   * The seam's `task` argument is deliberately not in this signature: BGE-M3 is
   * symmetric, so there is nothing to vary on it. Callers still pass it — TS
   * permits an implementation that accepts fewer parameters — and a future
   * asymmetric provider can take it without touching a single call site.
   */
  async embed(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) return { vectors: [], model: EMBEDDING_MODEL };
    if (texts.length > this.maxBatchSize) {
      // Callers batch; exceeding the provider limit is a programming error.
      throw new PermanentError(
        `Embedding batch of ${texts.length} exceeds the Workers AI limit of ${this.maxBatchSize} inputs per request`,
      );
    }

    const body = await workersAiRun<BgeM3EmbeddingOutput>(EMBEDDING_MODEL, {
      text: texts,
      // Clip over-long inputs instead of erroring. Chunks are sized well below
      // the model's 60k-token context, so this is a safety net only.
      truncate_inputs: true,
    });

    const data = body.data;
    if (!data || data.length !== texts.length) {
      throw new Error(
        `Workers AI returned ${data?.length ?? 0} embeddings for ${texts.length} inputs`,
      );
    }

    const vectors = data.map((values, i) => {
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

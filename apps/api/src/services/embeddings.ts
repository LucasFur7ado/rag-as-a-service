/**
 * Embedding provider seam.
 *
 * Concrete implementations (Workers AI, OpenAI, Cohere, ...) plug in here so
 * the rest of the app depends only on this interface. Nothing calls these yet.
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
  /** Embed a batch of texts. */
  embed(texts: string[]): Promise<EmbedResult>;
}

/**
 * Placeholder implementation. Swap for a real provider (e.g. Workers AI via
 * `env.AI`) when implementing ingestion/retrieval.
 */
export class NotImplementedEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 0;

  // TODO: implement using Workers AI (env.AI.run(...)) or an external provider.
  embed(_texts: string[]): Promise<EmbedResult> {
    throw new Error("EmbeddingProvider.embed is not implemented");
  }
}

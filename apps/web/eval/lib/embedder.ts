import { EMBED_REQUEST_DELAY_MS } from "../config";
import type { EmbeddingProvider, EmbedResult, EmbeddingTask } from "../../src/server/services/embeddings";
import { countTokens } from "../../src/server/lib/tokens";
import { EmbeddingCache } from "./cache";
import { sleep, withRetries } from "./retry";

/**
 * A caching, batching, self-pacing wrapper around the PRODUCTION embedding
 * provider.
 *
 * It implements `EmbeddingProvider`, so `retrieveFromNamespace` accepts it
 * unchanged and every query in a run goes through the same retrieval code the
 * app uses. What it adds is only what a benchmark needs and a request path must
 * not have: a disk cache, batch splitting above the provider's limit, spacing
 * between requests, and a count of what was actually spent.
 *
 * It deliberately does NOT change how a vector is produced. Cache misses go
 * straight to `WorkersAiEmbeddingProvider`, normalization included — if this
 * wrapper altered a vector, the harness would be scoring a model the app does
 * not run.
 */

export interface EmbedderStats {
  /** Texts served from the disk cache. */
  cacheHits: number;
  /** Texts embedded by the real provider this run. */
  embedded: number;
  /** Requests actually sent to Workers AI. */
  requests: number;
  /** Tokens sent, counted with the same BPE tokenizer the app budgets with. */
  tokens: number;
}

export class CachedEmbedder implements EmbeddingProvider {
  readonly dimension: number;
  readonly maxBatchSize: number;
  readonly stats: EmbedderStats = { cacheHits: 0, embedded: 0, requests: 0, tokens: 0 };

  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly model: string,
    private readonly cache: EmbeddingCache = new EmbeddingCache(),
    private readonly requestDelayMs: number = EMBED_REQUEST_DELAY_MS,
  ) {
    this.dimension = inner.dimension;
    this.maxBatchSize = inner.maxBatchSize;
  }

  /**
   * Embed any number of texts, in provider-sized batches, reusing cached
   * vectors. Order of the returned vectors always matches the input.
   */
  async embed(texts: string[], task: EmbeddingTask = "document"): Promise<EmbedResult> {
    const vectors = new Array<number[] | undefined>(texts.length);

    // Pass 1: fill from cache and collect what is genuinely missing. Duplicate
    // texts within one call collapse to a single embedding.
    const missingIndexesByText = new Map<string, number[]>();
    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(texts[i], this.model);
      if (cached) {
        vectors[i] = cached;
        this.stats.cacheHits++;
        continue;
      }
      const existing = missingIndexesByText.get(texts[i]);
      if (existing) existing.push(i);
      else missingIndexesByText.set(texts[i], [i]);
    }

    // Pass 2: embed the misses in batches the provider will accept.
    const missingTexts = [...missingIndexesByText.keys()];
    for (let start = 0; start < missingTexts.length; start += this.maxBatchSize) {
      const batch = missingTexts.slice(start, start + this.maxBatchSize);
      const label = `embed ${batch.length} text(s)`;
      const result = await withRetries(label, () => this.inner.embed(batch, task));

      this.stats.requests++;
      this.stats.embedded += batch.length;
      for (const text of batch) this.stats.tokens += countTokens(text);

      batch.forEach((text, i) => {
        const vector = result.vectors[i];
        this.cache.set(text, this.model, vector);
        for (const index of missingIndexesByText.get(text) ?? []) vectors[index] = vector;
      });

      if (start + this.maxBatchSize < missingTexts.length) await sleep(this.requestDelayMs);
    }

    this.cache.flush();
    return { vectors: vectors as number[][], model: this.model };
  }

  /** Texts that are not yet cached — the real cost of a planned run. */
  countUncached(texts: string[]): number {
    const unseen = new Set<string>();
    for (const text of texts) if (!this.cache.has(text, this.model)) unseen.add(text);
    return unseen.size;
  }
}

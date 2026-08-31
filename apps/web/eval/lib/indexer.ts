import { VECTOR_TEXT_METADATA_MAX_CHARS } from "../../src/server/config";
import { chunkPages } from "../../src/server/lib/chunking";
import { vectorId, type VectorStore } from "../../src/server/services/vectorstore";
import type { CorpusDocument } from "./corpus";
import type { CachedEmbedder } from "./embedder";
import { assertEvalNamespace } from "./namespace";
import { sleep, withRetries } from "./retry";
import type { ChunkingConfig } from "./types";

/**
 * Building an experiment's index.
 *
 * The chunking is `chunkPages` from src/server/lib — the production chunker,
 * with the experiment's sizes passed as its existing parameters. The upsert is
 * the production `PineconeVectorStore`. What the harness supplies is only the
 * orchestration that ingestion cannot lend it, because ingestion's version is
 * wired to a document row, a tenant, and the database.
 *
 * The metadata written here mirrors ingestion's, including the source offsets
 * (`startChar`/`endChar`) that the whole span-anchored method depends on.
 */

export interface IndexedChunk {
  id: string;
  documentId: string;
  filename: string;
  page: number | null;
  startChar: number;
  endChar: number;
  text: string;
}

/**
 * Chunk the corpus under one chunking configuration.
 *
 * Each document is chunked on its own so chunk indexes — and therefore vector
 * ids — are per document, exactly as they are at ingestion.
 */
export function buildChunks(
  documents: CorpusDocument[],
  chunking: ChunkingConfig,
): IndexedChunk[] {
  if (chunking.strategy !== "recursive") {
    throw new Error(
      `Chunking strategy "${chunking.strategy}" is not implemented. The only strategy in ` +
        `src/server/lib/chunking.ts is "recursive"; add it there first so the harness measures real code.`,
    );
  }

  const chunks: IndexedChunk[] = [];
  for (const doc of documents) {
    for (const chunk of chunkPages(doc.pages, chunking.sizeChars, chunking.overlapChars)) {
      chunks.push({
        id: vectorId(doc.documentId, chunk.index),
        documentId: doc.documentId,
        filename: doc.filename,
        page: chunk.page,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
        text: chunk.text,
      });
    }
  }
  return chunks;
}

export interface IndexOutcome {
  namespace: string;
  chunkCount: number;
  /** True when the namespace already existed and was reused. */
  reused: boolean;
}

/**
 * Ensure a namespace holds this experiment's vectors.
 *
 * Reuses an existing namespace by default. The namespace name is a hash of the
 * corpus, chunking, and model (see namespace.ts), so an existing one provably
 * holds the right vectors — re-embedding it would spend quota to produce
 * identical results. `force` re-indexes anyway, for when the index is suspected
 * of being partial after an interrupted run.
 */
export async function ensureIndexed(
  store: VectorStore,
  embedder: CachedEmbedder,
  options: {
    namespace: string;
    chunks: IndexedChunk[];
    force: boolean;
    onProgress?: (message: string) => void;
    /**
     * How long to wait for the upserted vectors to become queryable. Defaults
     * to {@link VISIBILITY_TIMEOUT_MS}, which suits the committed corpus; a BEIR
     * corpus writes tens of thousands of vectors and needs longer (see
     * BEIR_VISIBILITY_TIMEOUT_MS). Raising it is not cosmetic — querying a
     * partially visible index does not fail, it reports better metrics than the
     * configuration earned.
     */
    visibilityTimeoutMs?: number;
  },
): Promise<IndexOutcome> {
  const { namespace, chunks, force } = options;
  const log = options.onProgress ?? (() => {});
  assertEvalNamespace(namespace);

  const existing = await withRetries("read index stats", () => store.namespaceStats());
  const existingCount = existing[namespace];
  if (existingCount !== undefined) {
    // Reuse only a namespace that is actually COMPLETE. The name is a hash of
    // the corpus, chunking, and model, so an existing one provably holds the
    // right *kind* of vectors — but not necessarily all of them. A run
    // interrupted partway (Ctrl-C, a crashed process, a provider outage) leaves
    // a namespace holding some prefix of the chunks, and reusing that scores
    // the configuration against a fraction of its own corpus.
    //
    // That failure is silent and it flatters: a missing chunk is one fewer
    // competitor for the top-k slots, so a half-written index does not error,
    // it reports metrics the configuration did not earn. Comparing the count is
    // the whole check, and repairing it is nearly free — the embedding cache is
    // keyed by content, so re-indexing chunks that were already embedded spends
    // no quota, only upserts.
    const complete = existingCount === chunks.length;
    if (!force && complete) return { namespace, chunkCount: chunks.length, reused: true };

    // Re-indexing in place would leave any chunk that no longer exists behind
    // as a stale vector. Drop the namespace and wait for the delete to drain
    // before writing, or the new vectors race the old delete.
    log(
      complete
        ? `--force: dropping ${namespace} before re-indexing`
        : `${namespace} holds ${existingCount} vectors but this configuration produces ` +
            `${chunks.length} — the index is incomplete, dropping and rebuilding it ` +
            `(cached embeddings make this cost no quota)`,
    );
    await withRetries(`delete ${namespace}`, () => store.deleteNamespace(namespace));
    await waitForNamespaceGone(store, namespace, log);
  }

  // Dimension preflight, the same check ingestion runs before its first upsert.
  const indexDim = await withRetries("describe index", () => store.indexDimension());
  if (indexDim !== null && indexDim !== embedder.dimension) {
    throw new Error(
      `Pinecone index dimension (${indexDim}) does not match the embedding model dimension ` +
        `(${embedder.dimension}). The harness shares the app's index; recreate it with dimension ` +
        `${embedder.dimension} and metric cosine.`,
    );
  }

  const batchSize = embedder.maxBatchSize;
  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const { vectors } = await embedder.embed(batch.map((c) => c.text), "document");

    await withRetries(`upsert ${batch.length} vectors`, () =>
      store.upsert(
        namespace,
        batch.map((chunk, i) => ({
          id: chunk.id,
          values: vectors[i],
          metadata: {
            documentId: chunk.documentId,
            chunkIndex: Number(chunk.id.split("#")[1] ?? 0),
            filename: chunk.filename,
            ...(chunk.page !== null ? { page: chunk.page } : {}),
            startChar: chunk.startChar,
            endChar: chunk.endChar,
            text: chunk.text.slice(0, VECTOR_TEXT_METADATA_MAX_CHARS),
          },
        })),
      ),
    );
    log(`indexed ${Math.min(start + batchSize, chunks.length)}/${chunks.length} chunks`);
  }

  await waitForVisibility(store, namespace, chunks.length, log, options.visibilityTimeoutMs);
  return { namespace, chunkCount: chunks.length, reused: false };
}

/** How long to wait for a namespace to reach a stable, queryable state. */
const VISIBILITY_TIMEOUT_MS = 60_000;
const VISIBILITY_POLL_MS = 1_000;

/**
 * Block until a deleted namespace has actually disappeared.
 *
 * Pinecone's `deleteAll` is eventually consistent in both directions. Deleting
 * a namespace and immediately re-creating it under the same name — which the
 * harness does constantly, because the name is a hash of the configuration and
 * so is stable across runs — races: the in-flight delete arrives *after* the
 * new upserts and silently wipes them. The run then scores a mostly-empty
 * index and reports a dramatic, entirely fictional regression.
 *
 * That is not a hypothetical. It produced a `topK 20` run scoring 0.04 hit@1
 * against the same index where `topK 8` scored 0.74.
 */
export async function waitForNamespaceGone(
  store: VectorStore,
  namespace: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  const deadline = Date.now() + VISIBILITY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const stats = await withRetries("read index stats", () => store.namespaceStats());
    if (stats[namespace] === undefined) return;
    onProgress?.(`waiting for ${namespace} to finish deleting (${stats[namespace]} vectors left)`);
    await sleep(VISIBILITY_POLL_MS);
  }
  console.warn(
    `  ! ${namespace} has not finished deleting after ${VISIBILITY_TIMEOUT_MS / 1000}s. ` +
      `Re-indexing it now risks losing the new vectors to the in-flight delete.`,
  );
}

/**
 * Block until every upserted vector is visible to queries.
 *
 * Pinecone serverless is eventually consistent: an upsert returns before its
 * vectors are searchable. Querying immediately therefore searches a partially
 * populated index, and — because a missing chunk is one fewer competitor for
 * the top-k slots — it does not fail, it silently reports *better* metrics than
 * the configuration deserves. That made the same experiment score differently
 * on a fresh index than on a reused one, which is exactly the kind of
 * irreproducibility that makes a benchmark worthless.
 *
 * Times out rather than hanging; a slow index is reported and the run
 * continues, with the caveat visible in the log.
 */
async function waitForVisibility(
  store: VectorStore,
  namespace: string,
  expected: number,
  onProgress?: (message: string) => void,
  timeoutMs: number = VISIBILITY_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let visible = 0;
  let stableReadings = 0;

  while (Date.now() < deadline) {
    const stats = await withRetries("read index stats", () => store.namespaceStats());
    visible = stats[namespace] ?? 0;
    // Two consecutive full readings, not one: the count can reach `expected`
    // and then fall again while a stale delete finishes propagating.
    if (visible >= expected) {
      if (++stableReadings >= 2) return;
    } else {
      stableReadings = 0;
    }
    onProgress?.(`waiting for ${visible}/${expected} vectors to become queryable`);
    await sleep(VISIBILITY_POLL_MS);
  }

  console.warn(
    `  ! ${namespace} still shows ${visible}/${expected} vectors after ` +
      `${timeoutMs / 1000}s. Querying anyway — treat this run's metrics as unreliable ` +
      `and re-run to confirm.`,
  );
}

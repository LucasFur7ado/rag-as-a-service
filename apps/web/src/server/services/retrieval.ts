import type { EmbeddingProvider } from "./embeddings";
import type { VectorStore } from "./vectorstore";
import { vectorNamespace } from "./vectorstore";

/**
 * Retrieval stage of the query pipeline: embed the question, run a similarity
 * search scoped to the tenant+collection, and normalize the matches into
 * typed chunks. Pure orchestration over the EmbeddingProvider/VectorStore
 * seams — no SDK calls, so it is testable with fakes.
 */

/** A chunk retrieved from the vector store, with its stored metadata. */
export interface RetrievedChunk {
  documentId: string;
  chunkIndex: number;
  /** Original filename of the source document. */
  filename: string;
  /** 1-based page number (PDF) or null for unpaged sources. */
  page: number | null;
  /** Chunk text as stored in vector metadata at ingestion time. */
  text: string;
  /** Cosine similarity in [0, 1]. */
  score: number;
  /**
   * Offsets of this chunk within its source page text, as recorded at
   * ingestion. Null for vectors written before offsets were stored — nothing in
   * the query pipeline reads them, but the eval harness needs them to judge a
   * result against a golden source span.
   */
  startChar: number | null;
  endChar: number | null;
}

export interface RetrieveOptions {
  tenantId: string;
  collectionId: string;
  query: string;
  topK: number;
}

/** Retrieved chunks plus per-stage wall-clock timings (for analytics). */
export interface RetrievalResult {
  chunks: RetrievedChunk[];
  /** Time spent embedding the query (ms). */
  embedMs: number;
  /** Time spent in the vector-store similarity search (ms). */
  retrievalMs: number;
}

/**
 * Embed the query and fetch the top-k nearest chunks.
 *
 * Query-side embedding convention: the query goes through the SAME model as
 * ingestion (or retrieval breaks — the two vectors must live in one space),
 * but with `task: "query"` rather than `"document"`. BGE-M3 is symmetric and
 * ignores the distinction; the argument is passed anyway because an asymmetric
 * provider — one that encodes a *question* differently from a *passage* so
 * short interrogative text lands near the long declarative passages that answer
 * it — cannot recover the caller's intent after the fact.
 *
 * Tenant isolation (two layers):
 * 1. The search runs inside the tenant+collection namespace built by
 *    `vectorNamespace` — the only namespace constructor in the codebase.
 * 2. Defense-in-depth: a `tenantId` metadata filter is applied server-side by
 *    Pinecone, so even a namespace-construction bug cannot surface another
 *    tenant's vectors.
 *
 * Hybrid search: dense-only. The Workers AI endpoint for bge-m3 returns dense
 * vectors only, so no sparse/lexical weights were stored at ingestion and there
 * is nothing to fuse. // TODO: hybrid search — if sparse vectors become available
 * (a provider exposing them, or a separate BM25 encoder), store them at
 * ingestion and issue a sparse-dense query here (Pinecone native hybrid, or
 * RRF-fuse two result lists).
 */
export async function retrieveChunks(
  embedder: EmbeddingProvider,
  store: VectorStore,
  { tenantId, collectionId, query, topK }: RetrieveOptions,
): Promise<RetrievalResult> {
  return retrieveFromNamespace(embedder, store, {
    namespace: vectorNamespace(tenantId, collectionId),
    query,
    topK,
    filter: { tenantId: { $eq: tenantId } },
  });
}

/** Namespace-addressed form of {@link retrieveChunks}. */
export interface NamespaceRetrieveOptions {
  namespace: string;
  query: string;
  topK: number;
  /** Metadata filter passed through to the vector store; omit for none. */
  filter?: Record<string, unknown>;
}

/**
 * Embed a query and search one namespace directly.
 *
 * This is the whole retrieval stage — embed, search, normalize matches — with
 * the namespace and filter supplied rather than derived from a tenant. It exists
 * so the evaluation harness (apps/web/eval) can point the *production* retrieval
 * path at its own `__eval__` namespaces instead of reimplementing it; a
 * reimplementation would be measuring the harness, not the app.
 *
 * Application code should call {@link retrieveChunks}, which is the only caller
 * that constructs a tenant namespace and the tenant metadata filter together.
 */
export async function retrieveFromNamespace(
  embedder: EmbeddingProvider,
  store: VectorStore,
  { namespace, query, topK, filter }: NamespaceRetrieveOptions,
): Promise<RetrievalResult> {
  // Time the two stages separately so analytics can attribute latency
  // (embedding vs. vector search) — behaviour is otherwise unchanged.
  const embedStart = Date.now();
  const { vectors } = await embedder.embed([query], "query");
  const embedMs = Date.now() - embedStart;

  const retrievalStart = Date.now();
  const matches = await store.query(namespace, {
    vector: vectors[0],
    topK,
    filter,
  });
  const retrievalMs = Date.now() - retrievalStart;

  const chunks = matches.flatMap((match) => {
    const meta = match.metadata ?? {};
    const text = typeof meta.text === "string" ? meta.text : "";
    // A vector without its text metadata can't be cited or put in context —
    // skip it (only possible for vectors written outside the ingest pipeline).
    if (!text) return [];
    return [
      {
        documentId: String(meta.documentId ?? match.id.split("#")[0]),
        chunkIndex:
          typeof meta.chunkIndex === "number"
            ? meta.chunkIndex
            : Number(match.id.split("#")[1] ?? 0),
        filename: String(meta.filename ?? "unknown"),
        page: typeof meta.page === "number" ? meta.page : null,
        text,
        score: match.score,
        startChar: typeof meta.startChar === "number" ? meta.startChar : null,
        endChar: typeof meta.endChar === "number" ? meta.endChar : null,
      },
    ];
  });

  return { chunks, embedMs, retrievalMs };
}

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
 * but with `task: "query"` rather than `"document"`. Gemini embeds
 * asymmetrically, and asking it to encode a *question* rather than a *passage*
 * is what makes short interrogative text land near the long declarative
 * passages that answer it.
 *
 * Tenant isolation (two layers):
 * 1. The search runs inside the tenant+collection namespace built by
 *    `vectorNamespace` — the only namespace constructor in the codebase.
 * 2. Defense-in-depth: a `tenantId` metadata filter is applied server-side by
 *    Pinecone, so even a namespace-construction bug cannot surface another
 *    tenant's vectors.
 *
 * Hybrid search: dense-only. Gemini's embedding API returns dense vectors
 * only, so no sparse/lexical weights were stored at ingestion and there is
 * nothing to fuse. // TODO: hybrid search — if sparse vectors become available
 * (a provider exposing them, or a separate BM25 encoder), store them at
 * ingestion and issue a sparse-dense query here (Pinecone native hybrid, or
 * RRF-fuse two result lists).
 */
export async function retrieveChunks(
  embedder: EmbeddingProvider,
  store: VectorStore,
  { tenantId, collectionId, query, topK }: RetrieveOptions,
): Promise<RetrievalResult> {
  // Time the two stages separately so analytics can attribute latency
  // (embedding vs. vector search) — behaviour is otherwise unchanged.
  const embedStart = Date.now();
  const { vectors } = await embedder.embed([query], "query");
  const embedMs = Date.now() - embedStart;

  const retrievalStart = Date.now();
  const matches = await store.query(vectorNamespace(tenantId, collectionId), {
    vector: vectors[0],
    topK,
    filter: { tenantId: { $eq: tenantId } },
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
      },
    ];
  });

  return { chunks, embedMs, retrievalMs };
}

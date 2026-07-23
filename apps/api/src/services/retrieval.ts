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

/**
 * Embed the query and fetch the top-k nearest chunks.
 *
 * Query-side embedding convention: BGE-M3 (the ingestion model — the SAME
 * model must embed queries or retrieval breaks) is trained to work without
 * instruction/prefix on either side, unlike e.g. bge-*-v1.5 which wants a
 * "Represent this sentence..." query prefix. The raw question is therefore
 * embedded as-is.
 *
 * Tenant isolation (two layers):
 * 1. The search runs inside the tenant+collection namespace built by
 *    `vectorNamespace` — the only namespace constructor in the codebase.
 * 2. Defense-in-depth: a `tenantId` metadata filter is applied server-side by
 *    Pinecone, so even a namespace-construction bug cannot surface another
 *    tenant's vectors.
 *
 * Hybrid search: dense-only. The Workers AI bge-m3 binding does not expose
 * the model's sparse/lexical weights (it returns `{ data: number[][] }`
 * only), so no sparse vectors were stored at ingestion and there is nothing
 * to fuse. // TODO: hybrid search — if sparse vectors become available
 * (Workers AI exposing bge-m3 sparse output, or a separate BM25 encoder),
 * store them at ingestion and issue a sparse-dense query here (Pinecone
 * native hybrid, or RRF-fuse two result lists).
 */
export async function retrieveChunks(
  embedder: EmbeddingProvider,
  store: VectorStore,
  { tenantId, collectionId, query, topK }: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const { vectors } = await embedder.embed([query]);

  const matches = await store.query(vectorNamespace(tenantId, collectionId), {
    vector: vectors[0],
    topK,
    filter: { tenantId: { $eq: tenantId } },
  });

  return matches.flatMap((match) => {
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
}

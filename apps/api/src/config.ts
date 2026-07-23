/**
 * Ingestion tuning knobs — every size/limit the pipeline uses lives here so
 * chunking/batching behaviour can be tuned in one place (re-run ingestion with
 * POST /v1/documents/:id/reingest after changing them; vector ids are
 * deterministic so re-runs overwrite instead of duplicating).
 */

// --- Chunking ---------------------------------------------------------------
/** Target chunk size in characters (~200-250 tokens). */
export const CHUNK_SIZE_CHARS = 900;
/** Overlap carried between consecutive chunks (~15% of CHUNK_SIZE_CHARS). */
export const CHUNK_OVERLAP_CHARS = 135;

// --- Embeddings (Workers AI) ------------------------------------------------
/** BGE-M3: multilingual, 1024-dim dense embeddings. */
export const EMBEDDING_MODEL = "@cf/baai/bge-m3" as const;
/** Output dimensionality of EMBEDDING_MODEL — must match the Pinecone index. */
export const EMBEDDING_DIMENSION = 1024;
/** Workers AI accepts at most 100 inputs per embedding request. */
export const MAX_EMBED_BATCH_SIZE = 100;

// --- Vector upserts (Pinecone) ----------------------------------------------
/** Max vectors per upsert request (Pinecone recommends 100-200). */
export const MAX_UPSERT_BATCH_SIZE = 150;
/**
 * Soft cap on the JSON payload size of one upsert request. Pinecone rejects
 * requests over 2 MB; batches are split further when the estimate exceeds this.
 */
export const MAX_UPSERT_REQUEST_BYTES = 1_800_000;
/**
 * Max characters of chunk text stored as vector metadata (needed later for
 * context assembly). Chunks are already <= CHUNK_SIZE_CHARS; this is a
 * defensive cap to stay well inside Pinecone's 40 KB metadata limit.
 */
export const VECTOR_TEXT_METADATA_MAX_CHARS = 4000;

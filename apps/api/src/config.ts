/**
 * Pipeline tuning knobs — every size/limit/model id the ingestion AND query
 * pipelines use lives here so behaviour can be tuned in one place (re-run
 * ingestion with POST /v1/documents/:id/reingest after changing chunking
 * constants; vector ids are deterministic so re-runs overwrite instead of
 * duplicating. Query constants take effect immediately).
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

// --- Query pipeline: retrieval ----------------------------------------------
/** Default number of chunks fetched from the vector store per query. */
export const TOP_K = 8;
/** Hard cap on client-requested `topK` (protects latency + context budget). */
export const MAX_TOP_K = 20;
/**
 * Minimum cosine similarity for a retrieved chunk to enter the context.
 * BGE-M3 cosine scores: on-topic chunks usually land ≥ ~0.5, unrelated text
 * ~0.3 or below. Raise for stricter grounding (more "no relevant content"
 * answers), lower if relevant chunks are being dropped.
 */
export const SIMILARITY_THRESHOLD = 0.35;
/**
 * Two chunks whose word-trigram Jaccard similarity exceeds this are treated
 * as near-duplicates; only the higher-scoring one is kept. Catches chunk
 * overlap and duplicate uploads without dropping merely-related chunks.
 */
export const NEAR_DUPLICATE_JACCARD = 0.85;

// --- Query pipeline: context assembly ---------------------------------------
/**
 * Max tokens of retrieved context sent to the model (question and system
 * prompt are budgeted separately). Counted with a real BPE tokenizer (see
 * lib/tokens.ts). Lowest-scoring chunks are dropped first when over budget.
 * Keep comfortably under the generation model's context window minus prompt
 * + answer headroom.
 */
export const CONTEXT_TOKEN_BUDGET = 4000;
/** Reject queries longer than this many characters (400 Bad Request). */
export const MAX_QUERY_LENGTH = 2000;
/** Max characters of a chunk echoed back to the client as a citation snippet. */
export const CITATION_SNIPPET_MAX_CHARS = 500;

// --- Query pipeline: generation (Workers AI) --------------------------------
/**
 * Instruction-tuned open-weights model used for answer generation. Llama 3.3
 * 70B (fp8, "fast") is the strongest instruction-follower on the Workers AI
 * catalog — citation discipline ([n] markers, refusing out-of-context
 * questions) degrades noticeably on smaller models. Swap for e.g.
 * "@cf/meta/llama-3.1-8b-instruct-fast" to trade quality for latency/neurons.
 */
export const GENERATION_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;
/** Max tokens the model may generate for one answer. */
export const GENERATION_MAX_TOKENS = 1024;
/** Low temperature: grounded Q&A wants determinism, not creativity. */
export const GENERATION_TEMPERATURE = 0.1;

// --- API keys (Feature 4) ---------------------------------------------------
/** Prefix on every issued key. `live` leaves room for a future `rag_test_`. */
export const API_KEY_PREFIX = "rag_live_";
/**
 * Bytes of CSPRNG randomness in a key (encoded base64url). 32 bytes = 256 bits
 * of entropy — brute-force infeasible; the stored SHA-256 hash is 1:1 with it.
 */
export const API_KEY_RANDOM_BYTES = 32;
/** Characters of the key kept (beyond the prefix) for the display prefix. */
export const API_KEY_DISPLAY_CHARS = 4;

// --- Rate limiting (Feature 4) ----------------------------------------------
/**
 * Default per-key request cap (requests/minute) when a key doesn't override it.
 * Overridable per key via `rate_limit_per_minute`.
 */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
/** Hard ceiling on a client-requested per-key limit (guards against typos/abuse). */
export const MAX_RATE_LIMIT_PER_MINUTE = 6000;
/** Rate-limit window. The RateLimiter DO counts hits over this sliding window. */
export const RATE_LIMIT_WINDOW_MS = 60_000;
/**
 * Minimum spacing between `last_used_at` writes per key. Auth is on the hot
 * path, so we throttle these fire-and-forget D1 writes (via ctx.waitUntil) to
 * at most one per key per this interval instead of writing on every request.
 */
export const LAST_USED_THROTTLE_MS = 60_000;
// Session (dashboard) traffic is intentionally NOT rate-limited here: it is
// Clerk-gated, interactive, and low-volume, and the product surface we are
// protecting is programmatic API-key traffic. See README → Rate limiting.

/**
 * Pipeline tuning knobs — every size/limit/model id the ingestion AND query
 * pipelines use lives here so behaviour can be tuned in one place (re-run
 * ingestion with POST /api/v1/documents/:id/reingest after changing chunking
 * constants; vector ids are deterministic so re-runs overwrite instead of
 * duplicating. Query constants take effect immediately).
 *
 * This module is intentionally free of `server-only` and of any environment
 * access: the build-time OpenAPI generator (scripts/gen-openapi.ts) imports it
 * outside the Next runtime.
 */

import { VERSION } from "./version";

// --- OpenAPI / developer docs -----------------------------------------------
/**
 * Public repository link, surfaced in the OpenAPI `info.contact`. Not a runtime
 * URL — purely documentation metadata. Override per fork.
 */
export const REPO_URL = "https://github.com/your-org/rag-as-a-service";

/**
 * Static Info block for the generated OpenAPI document. `version` tracks the
 * API version in {@link VERSION} (src/server/version.ts) — the single
 * spec-version source (bump it on releases and the spec + docs follow).
 */
export const OPENAPI_INFO = {
  title: "RAG as a Service API",
  version: VERSION,
  description:
    "Multi-tenant retrieval-augmented generation platform. Upload documents into " +
    "collections, then ask grounded questions and get answers with citations. " +
    "Authenticate with an API key (`Authorization: Bearer rag_live_…`) for " +
    "programmatic access, or a Clerk session for dashboard-only endpoints.",
  contact: { name: "RAG as a Service", url: REPO_URL },
} as const;

/**
 * Path prefix every API route sits under. The backend runs inside the Next.js
 * app now, so the OpenAPI `servers` entries carry this suffix and the spec's
 * own paths stay clean (`/v1/collections`, not `/api/v1/collections`).
 */
export const API_BASE_PATH = "/api";

/** Local dev server, always advertised in the spec's `servers` list. */
export const LOCAL_API_URL = `http://localhost:3000${API_BASE_PATH}`;

/**
 * Build the OpenAPI `servers` list. The public/production base URL is read from
 * the `PUBLIC_API_URL` env var so nothing is hardcoded; the request origin is
 * used as a fallback, and local dev is always listed for the "Try it" console.
 */
export function openApiServers(
  publicApiUrl: string | undefined,
  requestOrigin?: string,
): Array<{ url: string; description: string }> {
  const servers: Array<{ url: string; description: string }> = [];
  const explicit = publicApiUrl?.trim();
  const production =
    explicit || (requestOrigin?.trim() ? `${requestOrigin.trim()}${API_BASE_PATH}` : "");
  if (production && production.replace(/\/$/, "") !== LOCAL_API_URL) {
    servers.push({ url: production.replace(/\/$/, ""), description: "Production" });
  }
  servers.push({ url: LOCAL_API_URL, description: "Local development" });
  return servers;
}

// --- Chunking ---------------------------------------------------------------
/** Target chunk size in characters (~200-250 tokens). */
export const CHUNK_SIZE_CHARS = 900;
/** Overlap carried between consecutive chunks (~15% of CHUNK_SIZE_CHARS). */
export const CHUNK_OVERLAP_CHARS = 135;

// --- Embeddings (Google Gemini) ---------------------------------------------
/**
 * Gemini's text embedding model. Free tier on Google AI Studio, and — unlike
 * most embedding models — its output dimensionality is configurable via
 * Matryoshka representation learning, which is what lets us keep the existing
 * 1024-dimension Pinecone index instead of recreating it.
 */
export const EMBEDDING_MODEL = "gemini-embedding-001" as const;
/**
 * Output dimensionality requested from EMBEDDING_MODEL — must match the
 * Pinecone index. 1024 is the dimension the index was created with; the
 * pipeline verifies the match before its first upsert and fails loudly.
 */
export const EMBEDDING_DIMENSION = 1024;
/**
 * Inputs per embedding request. `batchEmbedContents` accepts up to 100
 * requests per call; Gemini's free-tier rate limits are per-request, not
 * per-input, so batching hard is also what keeps ingestion inside them.
 */
export const MAX_EMBED_BATCH_SIZE = 100;
/**
 * Delay between embedding batches during ingestion (ms). The free tier is
 * capped at a handful of requests per minute; without spacing, a document of
 * more than a couple hundred chunks trips a 429 mid-pipeline. Set to 0 on a
 * paid tier.
 */
export const EMBED_BATCH_DELAY_MS = 1_000;

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
 * Gemini embeddings put on-topic chunks around ~0.6-0.8 and unrelated text
 * near ~0.4, so this sits deliberately low. Raise for stricter grounding
 * (more "no relevant content" answers), lower if relevant chunks are dropped.
 */
export const SIMILARITY_THRESHOLD = 0.45;
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
 */
export const CONTEXT_TOKEN_BUDGET = 4000;
/** Reject queries longer than this many characters (400 Bad Request). */
export const MAX_QUERY_LENGTH = 2000;
/** Max characters of a chunk echoed back to the client as a citation snippet. */
export const CITATION_SNIPPET_MAX_CHARS = 500;

// --- Query pipeline: generation (Google Gemini) ------------------------------
/**
 * Instruction-tuned model used for answer generation. Gemini 2.5 Flash is on
 * the free tier, streams natively, and follows the citation contract ([n]
 * markers, refusing out-of-context questions) reliably. Swap for
 * "gemini-2.5-flash-lite" to trade quality for latency/quota.
 */
export const GENERATION_MODEL = "gemini-2.5-flash" as const;
/** Max tokens the model may generate for one answer. */
export const GENERATION_MAX_TOKENS = 1024;
/** Low temperature: grounded Q&A wants determinism, not creativity. */
export const GENERATION_TEMPERATURE = 0.1;
/**
 * Thinking budget (tokens) for Gemini 2.5's reasoning phase. Zero disables it:
 * grounded extraction from supplied passages needs no chain of thought, and
 * thinking tokens are billed, counted against the free-tier quota, and add
 * seconds of latency before the first streamed token.
 */
export const GENERATION_THINKING_BUDGET = 0;

// --- API keys ---------------------------------------------------------------
/** Prefix on every issued key. `live` leaves room for a future `rag_test_`. */
export const API_KEY_PREFIX = "rag_live_";
/**
 * Bytes of CSPRNG randomness in a key (encoded base64url). 32 bytes = 256 bits
 * of entropy — brute-force infeasible; the stored SHA-256 hash is 1:1 with it.
 */
export const API_KEY_RANDOM_BYTES = 32;
/** Characters of the key kept (beyond the prefix) for the display prefix. */
export const API_KEY_DISPLAY_CHARS = 4;

// --- Rate limiting ----------------------------------------------------------
/**
 * Default per-key request cap (requests/minute) when a key doesn't override it.
 * Overridable per key via `rate_limit_per_minute`.
 */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
/** Hard ceiling on a client-requested per-key limit (guards against typos/abuse). */
export const MAX_RATE_LIMIT_PER_MINUTE = 6000;
/** Rate-limit window. The limiter counts hits over this sliding window. */
export const RATE_LIMIT_WINDOW_MS = 60_000;
/**
 * Minimum spacing between `last_used_at` writes per key. Auth is on the hot
 * path, so we throttle these fire-and-forget writes (via `after()`) to at most
 * one per key per this interval instead of writing on every request.
 */
export const LAST_USED_THROTTLE_MS = 60_000;
/**
 * How long an idle `rate_limits` row is kept before the retention cron drops
 * it. Purely housekeeping — an expired row is indistinguishable from a missing
 * one (both mean "no hits in the window").
 */
export const RATE_LIMIT_ROW_TTL_MS = 3_600_000;
// Session (dashboard) traffic is intentionally NOT rate-limited here: it is
// Clerk-gated, interactive, and low-volume, and the product surface we are
// protecting is programmatic API-key traffic. See README → Rate limiting.

// --- Usage analytics --------------------------------------------------------
/**
 * How long `usage_events` rows are retained. A daily Vercel Cron job (see
 * vercel.json + app/api/cron/prune/route.ts) prunes rows older than this.
 */
export const ANALYTICS_RETENTION_DAYS = 90;

/**
 * Whether to persist the raw plaintext query text on `usage_events`. OFF by
 * default for privacy — only a SHA-256 hash + length are stored (enough to
 * spot duplicate/abusive queries without retaining user content). Flip to
 * `true` ONLY with a clear reason and disclosure. See README → Privacy.
 */
export const STORE_RAW_QUERY_TEXT = false;

/**
 * Default dashboard window when the UI doesn't specify one, in days. The web
 * date-range picker defaults to this; the API never assumes a range.
 */
export const ANALYTICS_DEFAULT_RANGE_DAYS = 7;

/**
 * Per-model cost constants (USD) used to estimate query cost from token
 * counts. Both models below are FREE on the Gemini free tier, so these are the
 * paid-tier list prices — they exist to give the dashboard a *relative* cost
 * signal and a realistic figure if the project ever moves to a paid key. NOT a
 * billing source of truth (billing is out of scope). Rates are USD per single
 * token (i.e. per-1M-token price / 1_000_000).
 */
export const MODEL_COSTS: Record<
  string,
  { inputPerToken: number; outputPerToken: number }
> = {
  // Gemini 2.5 Flash — generation model (see GENERATION_MODEL).
  "gemini-2.5-flash": {
    inputPerToken: 0.3 / 1_000_000, // ~$0.30 / 1M input tokens (paid tier)
    outputPerToken: 2.5 / 1_000_000, // ~$2.50 / 1M output tokens (paid tier)
  },
  // Gemini embeddings — priced per input token (output has no token cost).
  "gemini-embedding-001": {
    inputPerToken: 0.15 / 1_000_000, // ~$0.15 / 1M input tokens (paid tier)
    outputPerToken: 0,
  },
};

/** Fallback per-token rates for a model not present in MODEL_COSTS. */
export const DEFAULT_MODEL_COST = {
  inputPerToken: 0.5 / 1_000_000,
  outputPerToken: 1.5 / 1_000_000,
};

/**
 * Estimate the USD cost of a generation from its token counts, using
 * {@link MODEL_COSTS} (falling back to {@link DEFAULT_MODEL_COST}). A rough,
 * relative signal for the dashboard — NOT a billing figure (see the comment
 * on MODEL_COSTS). Unknown token counts contribute 0.
 */
export function estimateCost(
  model: string,
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
): number {
  const rate = MODEL_COSTS[model] ?? DEFAULT_MODEL_COST;
  return (
    (promptTokens ?? 0) * rate.inputPerToken +
    (completionTokens ?? 0) * rate.outputPerToken
  );
}

// --- Ingestion --------------------------------------------------------------
/** Max accepted upload size. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/**
 * Retries applied to a transient ingestion step failure (network, 429, 5xx).
 * A `PermanentError` skips retries entirely and fails the document at once.
 */
export const INGEST_STEP_RETRIES = 3;
/** Base backoff between ingestion step retries (ms); doubles each attempt. */
export const INGEST_RETRY_BASE_MS = 2_000;

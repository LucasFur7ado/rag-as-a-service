/**
 * @rag/shared — shared domain types for the RAG-as-a-Service platform.
 *
 * Types only. This package intentionally contains NO runtime logic so it can be
 * imported by both the Next.js app (`apps/web`) and the Cloudflare Worker API
 * (`apps/api`) without pulling in any dependencies.
 */

/** ISO-8601 timestamp string, e.g. "2026-07-21T12:34:56.000Z". */
export type IsoDateString = string;

/**
 * A tenant is the top-level isolation boundary. Every Collection, Document and
 * query is scoped to exactly one tenant. In the current model a tenant maps to
 * a Clerk organization (or a single user acting as their own tenant).
 */
export interface Tenant {
  id: string;
  /** Human-readable name shown in the dashboard. */
  name: string;
  /** URL-safe unique slug. */
  slug: string;
  createdAt: IsoDateString;
}

/** Epoch milliseconds — how the API stores and returns timestamps (D1 integer). */
export type EpochMillis = number;

/**
 * A collection is a named group of documents that are indexed together and
 * queried as a unit (roughly: one knowledge base / one vector namespace).
 * Mirrors the D1 `collections` table (apps/api/src/db/schema.ts).
 */
export interface Collection {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
}

/**
 * Lifecycle status of a document. Uploads start at `uploaded`; the ingestion
 * pipeline (parse → chunk → embed → upsert) moves it to `processing` and then
 * `ready`, or `error` with a message.
 */
export type DocumentStatus = "uploaded" | "processing" | "ready" | "error";

/**
 * A source document uploaded into a collection. The raw bytes live in R2;
 * this record (D1 `documents` table) is the metadata handle.
 */
export interface Document {
  id: string;
  tenantId: string;
  collectionId: string;
  /** Original filename, e.g. "report.pdf". */
  filename: string;
  /** MIME type of the source, e.g. "application/pdf". */
  contentType: string;
  /** Size of the source in bytes. */
  sizeBytes: number;
  status: DocumentStatus;
  /** Populated when `status === "error"`. */
  error?: string;
  /** Number of chunks indexed. Populated when `status === "ready"`. */
  chunkCount?: number;
  /** When ingestion last completed successfully. */
  ingestedAt?: EpochMillis;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
}

// --- Request / response shapes ---------------------------------------------

/** Body for POST /v1/collections. */
export interface CreateCollectionRequest {
  name: string;
  description?: string;
}

/** Response for GET /v1/collections. */
export interface ListCollectionsResponse {
  collections: Collection[];
}

/** Response for GET /v1/collections/:id/documents. */
export interface ListDocumentsResponse {
  documents: Document[];
}

/**
 * Response for POST /v1/collections/:id/documents (multipart upload, field
 * `file`). The created document starts with `status: "uploaded"`.
 */
export interface UploadDocumentResponse {
  document: Document;
}

/** Response for GET /v1/documents/:id/status — lightweight polling shape. */
export interface DocumentStatusResponse {
  status: DocumentStatus;
  /** Populated when `status === "ready"`. */
  chunkCount?: number;
  /** Populated when `status === "error"`. */
  error?: string;
  updatedAt: EpochMillis;
}

/** Response for POST /v1/documents/:id/reingest (202 Accepted). */
export interface ReingestDocumentResponse {
  document: Document;
}

/**
 * Body for POST /v1/collections/:id/query. The collection is addressed by the
 * URL path; the body carries only the question and tuning overrides.
 */
export interface QueryRequest {
  /** The natural-language question. */
  query: string;
  /** Max number of source chunks to retrieve (server clamps to a sane range). */
  topK?: number;
  /**
   * Response mode. `true`/omitted → Server-Sent Events stream of
   * {@link QueryStreamEvent}s; `false` → a single JSON {@link QueryResponse}
   * (handy for curl and offline evaluation).
   */
  stream?: boolean;
}

/**
 * A citation pointing back to the source chunk that grounded (part of) an
 * answer. `marker` is the `[n]` label the model was told to cite with — the
 * client uses it to link inline markers in the answer to these entries.
 */
export interface Citation {
  /** 1-based context label, i.e. the `n` in the `[n]` markers in the answer. */
  marker: number;
  documentId: string;
  /** Original filename of the source document, e.g. "report.pdf". */
  filename: string;
  /** 1-based page number when the source has pages (PDF); null otherwise. */
  page: number | null;
  /** Index of the chunk within the document (stable across re-ingestion). */
  chunkIndex: number;
  /** The retrieved chunk text (may be truncated for transport). */
  snippet: string;
  /** Similarity score in [0, 1] from the vector store. */
  score: number;
  /** Whether the model actually cited this source in the answer. */
  cited: boolean;
}

/** Retrieval/generation accounting returned with every query response. */
export interface QueryUsage {
  /** Matches returned by the vector store before filtering. */
  chunksRetrieved: number;
  /** Chunks that survived threshold/dedupe/budget and entered the context. */
  chunksUsed: number;
  /** Tokens of context sent to the model (question and prompt excluded). */
  contextTokens: number;
  /**
   * Markers the model emitted that do NOT correspond to any retrieved chunk
   * (hallucinated citations). The client should render these as plain text.
   */
  invalidMarkers: number[];
  /** Model identifier that produced the answer. */
  model: string;
}

/** The non-streaming (`stream: false`) response shape. */
export interface QueryResponse {
  /** The generated answer (markdown, with inline `[n]` citation markers). */
  answer: string;
  /** Every source that entered the context, ordered by marker. */
  sources: Citation[];
  usage: QueryUsage;
}

// --- Streaming query events --------------------------------------------------
// The streaming response is SSE; each `data:` line is one JSON-encoded
// QueryStreamEvent. Order: zero+ `delta` → one `sources` → one `done`, or an
// `error` at any point (after which the stream ends).

/** An incremental piece of the generated answer text. */
export interface QueryDeltaEvent {
  type: "delta";
  text: string;
}

/** Terminal event carrying the resolved citations + usage. */
export interface QuerySourcesEvent {
  type: "sources";
  sources: Citation[];
  usage: QueryUsage;
}

/** Stream completed successfully. */
export interface QueryDoneEvent {
  type: "done";
}

/** Stream failed; `message` is safe to show to the user. */
export interface QueryErrorEvent {
  type: "error";
  message: string;
}

export type QueryStreamEvent =
  | QueryDeltaEvent
  | QuerySourcesEvent
  | QueryDoneEvent
  | QueryErrorEvent;

/**
 * How a request authenticated: an interactive Clerk dashboard session, or a
 * programmatic API key.
 */
export type AuthType = "session" | "apikey";

/**
 * The authenticated principal attached to a request after auth succeeds
 * (Clerk JWT or API key). Shared so both apps agree on the shape.
 */
export interface AuthContext {
  tenantId: string;
  /** How the caller authenticated. */
  authType: AuthType;
  /** Clerk user id — present only for `session` auth. */
  userId?: string;
  /** Id of the API key used — present only for `apikey` auth. */
  keyId?: string;
}

// --- API keys (Feature 4) ---------------------------------------------------

/**
 * An API key as exposed to the dashboard. NEVER contains key material: the
 * plaintext key is shown exactly once at creation (see {@link ApiKeyCreateResponse})
 * and only a display prefix + last-4 are retained afterwards.
 */
export interface ApiKey {
  id: string;
  /** Human-readable label chosen at creation. */
  name: string;
  /** Leading display portion, e.g. "rag_live_a1b2". Not usable to authenticate. */
  keyPrefix: string;
  /** Last 4 characters of the key, for disambiguation in the UI. */
  last4: string;
  /** Per-key request cap, requests per minute. */
  rateLimitPerMinute: number;
  createdAt: EpochMillis;
  /** Last successful auth with this key (throttled write); null if never used. */
  lastUsedAt?: EpochMillis;
  /** When the key was revoked; null/absent while active. */
  revokedAt?: EpochMillis;
}

/** Body for POST /v1/api-keys. */
export interface CreateApiKeyRequest {
  name: string;
  /** Optional per-key override; defaults to the server's configured limit. */
  rateLimitPerMinute?: number;
}

/**
 * Response for POST /v1/api-keys — the ONLY shape that ever carries the
 * plaintext key. Show it once, then discard it client-side.
 */
export interface ApiKeyCreateResponse {
  apiKey: ApiKey;
  /** The full plaintext key, e.g. "rag_live_…". Never returned again. */
  key: string;
}

/** Response for GET /v1/api-keys. */
export interface ListApiKeysResponse {
  apiKeys: ApiKey[];
}

/**
 * Body of a 429 Too Many Requests response from a rate-limited endpoint.
 * The response also carries `Retry-After` and `RateLimit-*` headers.
 */
export interface RateLimitErrorBody {
  error: string;
  /** Seconds until the caller may retry (mirrors the `Retry-After` header). */
  retryAfter: number;
  /** The limit that was exceeded (requests per minute). */
  limit: number;
}

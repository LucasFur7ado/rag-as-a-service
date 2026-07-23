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

/** A request to run a retrieval-augmented query against a collection. */
export interface QueryRequest {
  collectionId: string;
  /** The natural-language question. */
  query: string;
  /** Max number of source chunks to retrieve. Defaults are provider-specific. */
  topK?: number;
  /** If true, only retrieve context; skip LLM generation. */
  retrieveOnly?: boolean;
}

/** A citation pointing back to the source chunk that supported an answer. */
export interface Citation {
  documentId: string;
  documentName: string;
  /** Index of the chunk within the document. */
  chunkIndex: number;
  /** The retrieved text snippet. */
  text: string;
  /** Similarity/relevance score in [0, 1], if the store provides one. */
  score?: number;
}

/** The response from a retrieval-augmented query. */
export interface QueryResponse {
  /** The generated answer. Empty when `retrieveOnly` was requested. */
  answer: string;
  /** Sources that grounded the answer. */
  citations: Citation[];
  /** Model identifier that produced the answer, when generation ran. */
  model?: string;
}

/**
 * The authenticated principal attached to a request after JWT verification.
 * Shared so both apps agree on the shape.
 */
export interface AuthContext {
  userId: string;
  tenantId: string;
}

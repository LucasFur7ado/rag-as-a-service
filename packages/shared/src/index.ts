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

/**
 * A collection is a named group of documents that are indexed together and
 * queried as a unit (roughly: one knowledge base / one vector namespace).
 */
export interface Collection {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  /** Number of documents currently in the collection. */
  documentCount: number;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

/** Lifecycle status of an ingestion job for a single document. */
export type IngestJobStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed";

/**
 * A source document that has been (or is being) ingested into a collection.
 * The actual bytes/chunks/embeddings live in object storage and the vector
 * store; this record is the metadata handle.
 */
export interface Document {
  id: string;
  tenantId: string;
  collectionId: string;
  /** Original filename or display title. */
  name: string;
  /** MIME type of the source, e.g. "application/pdf". */
  contentType: string;
  /** Size of the source in bytes, if known. */
  sizeBytes?: number;
  status: IngestJobStatus;
  /** Populated when `status === "failed"`. */
  error?: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
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

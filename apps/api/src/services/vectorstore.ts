import {
  MAX_UPSERT_BATCH_SIZE,
  MAX_UPSERT_REQUEST_BYTES,
} from "../config";
import { PermanentError } from "../lib/errors";
import type { Env } from "../env";

/**
 * Vector store seam, implemented for Pinecone.
 *
 * Talks to the Pinecone data plane over plain `fetch` (REST) instead of the
 * `@pinecone-database/pinecone` SDK: it keeps the Worker bundle lean, avoids
 * SDK/runtime-compat risk, and gives exact control over request payload size
 * (Pinecone rejects requests over 2 MB). The interface keeps the provider
 * swappable — route handlers and Workflow steps depend only on `VectorStore`.
 */

export interface VectorRecord {
  id: string;
  values: number[];
  metadata?: Record<string, string | number | boolean>;
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface VectorQuery {
  vector: number[];
  topK: number;
  /** Metadata filter, provider-specific shape kept loose for now. */
  filter?: Record<string, unknown>;
}

export interface VectorStore {
  /** Insert or update records within a namespace. Batches internally. */
  upsert(namespace: string, records: VectorRecord[]): Promise<void>;
  /** Nearest-neighbour search within a namespace. */
  query(namespace: string, query: VectorQuery): Promise<VectorMatch[]>;
  /** Delete every vector belonging to a document (by the `{documentId}#` id prefix). */
  deleteByDocument(namespace: string, documentId: string): Promise<void>;
  /** Delete a whole namespace and everything in it. */
  deleteNamespace(namespace: string): Promise<void>;
  /** Dimensionality of the backing index, or null when unknown/empty. */
  indexDimension(): Promise<number | null>;
}

// --- Naming conventions -----------------------------------------------------
// Centralized so ingestion, deletion, and (later) retrieval agree on them.

/** Pinecone namespace for a tenant+collection — the isolation boundary. */
export function vectorNamespace(tenantId: string, collectionId: string): string {
  return `t_${tenantId}__c_${collectionId}`;
}

/**
 * Deterministic vector id. Re-ingesting a document upserts the same ids, so
 * re-runs overwrite instead of duplicating, and `{documentId}#` works as a
 * list/delete prefix.
 */
export function vectorId(documentId: string, chunkIndex: number): string {
  return `${documentId}#${chunkIndex}`;
}

// --- Pinecone implementation ------------------------------------------------

/** Pinecone caps ids per delete request. */
const MAX_DELETE_IDS = 1000;
/** Page size for GET /vectors/list (Pinecone max is 100). */
const LIST_PAGE_LIMIT = 100;

interface ListResponse {
  vectors?: { id: string }[];
  pagination?: { next?: string };
}

export class PineconeVectorStore implements VectorStore {
  private readonly host: string;
  private readonly apiKey: string;

  constructor(env: Pick<Env, "PINECONE_API_KEY" | "PINECONE_INDEX_HOST">) {
    // Catch the unconfigured/placeholder host up front: an unreachable host
    // would otherwise surface as workerd's opaque "internal error; reference
    // = ..." after burning the whole retry budget.
    if (
      !env.PINECONE_API_KEY ||
      !env.PINECONE_INDEX_HOST ||
      env.PINECONE_INDEX_HOST.includes("your-index-host")
    ) {
      throw new PermanentError(
        "Pinecone is not configured: set the PINECONE_API_KEY secret and PINECONE_INDEX_HOST var " +
          "(the index host from the Pinecone console — see README → Pinecone setup; " +
          "for local dev put both in apps/api/.dev.vars)",
      );
    }
    // Accept the host with or without a scheme (the console shows it bare).
    this.host = env.PINECONE_INDEX_HOST.replace(/^https?:\/\//, "").replace(/\/$/, "");
    this.apiKey = env.PINECONE_API_KEY;
  }

  async upsert(namespace: string, records: VectorRecord[]): Promise<void> {
    for (const batch of splitForUpsert(records)) {
      await this.request("POST", "/vectors/upsert", {
        namespace,
        vectors: batch,
      });
    }
  }

  async query(namespace: string, query: VectorQuery): Promise<VectorMatch[]> {
    const body = await this.request<{ matches?: VectorMatch[] }>("POST", "/query", {
      namespace,
      vector: query.vector,
      topK: query.topK,
      filter: query.filter,
      includeMetadata: true,
    });
    return (body.matches ?? []).map((m) => ({
      id: m.id,
      score: m.score ?? 0,
      metadata: m.metadata,
    }));
  }

  async deleteByDocument(namespace: string, documentId: string): Promise<void> {
    // Serverless indexes don't support metadata-filter deletes, so list the
    // document's ids by prefix (deterministic ids from `vectorId`) and delete
    // them in batches.
    const prefix = `${documentId}#`;
    let ids: string[] = [];
    let paginationToken: string | undefined;
    do {
      const params = new URLSearchParams({
        namespace,
        prefix,
        limit: String(LIST_PAGE_LIMIT),
      });
      if (paginationToken) params.set("paginationToken", paginationToken);
      const page = await this.request<ListResponse>(
        "GET",
        `/vectors/list?${params}`,
      );
      ids.push(...(page.vectors ?? []).map((v) => v.id));
      paginationToken = page.pagination?.next;

      if (ids.length >= MAX_DELETE_IDS || (!paginationToken && ids.length > 0)) {
        await this.request("POST", "/vectors/delete", { namespace, ids });
        ids = [];
      }
    } while (paginationToken);
  }

  async deleteNamespace(namespace: string): Promise<void> {
    await this.request("POST", "/vectors/delete", {
      namespace,
      deleteAll: true,
    });
  }

  async indexDimension(): Promise<number | null> {
    const stats = await this.request<{ dimension?: number }>(
      "POST",
      "/describe_index_stats",
      {},
    );
    return stats.dimension ?? null;
  }

  /**
   * Perform one data-plane request. Maps HTTP failures onto the error
   * taxonomy: 4xx (except 429) → PermanentError, everything else → transient.
   */
  private async request<T = unknown>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`https://${this.host}${path}`, {
        method,
        headers: {
          "Api-Key": this.apiKey,
          "Content-Type": "application/json",
          "X-Pinecone-API-Version": "2025-04",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // Name the host: workerd reports unreachable hosts as an opaque
      // "internal error; reference = ...". Transient (retryable) — a wrong
      // host is normally caught by the constructor's placeholder check.
      throw new Error(
        `Could not reach Pinecone at ${this.host}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      // Deleting from a namespace that was never written to 404s — that is
      // "already deleted" for our purposes, not an error.
      if (res.status === 404 && path.startsWith("/vectors/delete")) {
        return undefined as T;
      }
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      const message = `Pinecone ${method} ${path.split("?")[0]} failed (${res.status}): ${detail || res.statusText}`;
      if (res.status !== 429 && res.status >= 400 && res.status < 500) {
        // e.g. dimension mismatch, bad metadata, auth — retrying won't help.
        throw new PermanentError(message);
      }
      throw new Error(message);
    }
    return (await res.json()) as T;
  }
}

/**
 * Split records into upsert batches that respect both the max batch size and
 * the (estimated) max request bytes. Estimation uses JSON-serialized record
 * length, which tracks the real payload closely.
 */
function splitForUpsert(records: VectorRecord[]): VectorRecord[][] {
  const batches: VectorRecord[][] = [];
  let current: VectorRecord[] = [];
  let currentBytes = 0;

  for (const record of records) {
    const recordBytes = JSON.stringify(record).length + 1;
    const wouldOverflow =
      current.length >= MAX_UPSERT_BATCH_SIZE ||
      (current.length > 0 && currentBytes + recordBytes > MAX_UPSERT_REQUEST_BYTES);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(record);
    currentBytes += recordBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

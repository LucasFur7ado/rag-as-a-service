import {
  bigint,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

/**
 * Postgres schema (Drizzle, Neon). Metadata only — raw files live in Vercel
 * Blob under
 * `tenants/{tenantId}/collections/{collectionId}/documents/{documentId}/{filename}`.
 *
 * Timestamps are stored as epoch milliseconds to keep them TZ-unambiguous and
 * identical to the JSON the API returns. They are `bigint` and NOT `integer`:
 * epoch-ms is ~1.7e12, which overflows Postgres `int4` (max 2.1e9). Drizzle's
 * `mode: "number"` hands them back as JS numbers, which is exact well past the
 * year 275760.
 */

/** Epoch-milliseconds column. See the note above on why this must be bigint. */
const epochMs = (name: string) => bigint(name, { mode: "number" });

export const collections = pgTable(
  "collections",
  {
    id: text("id").primaryKey(), // uuid
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: epochMs("created_at").notNull(),
    updatedAt: epochMs("updated_at").notNull(),
  },
  (t) => [index("collections_tenant_id_idx").on(t.tenantId)],
);

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(), // uuid
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id),
    tenantId: text("tenant_id").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Vercel Blob pathname of the raw file (the store's own key space). */
    blobPath: text("blob_path").notNull(),
    /** 'uploaded' | 'processing' | 'ready' | 'error' — see DocumentStatus. */
    status: text("status").notNull().default("uploaded"),
    error: text("error"),
    /** Number of chunks indexed by the last successful ingestion run. */
    chunkCount: integer("chunk_count"),
    /** Epoch ms of the last successful ingestion run. */
    ingestedAt: epochMs("ingested_at"),
    /** Id of the most recent ingestion run (correlates the function logs). */
    ingestionRunId: text("ingestion_run_id"),
    createdAt: epochMs("created_at").notNull(),
    updatedAt: epochMs("updated_at").notNull(),
  },
  (t) => [
    index("documents_collection_id_idx").on(t.collectionId),
    index("documents_tenant_id_idx").on(t.tenantId),
  ],
);

/**
 * API keys. The plaintext key is NEVER stored — only its SHA-256 hash (unique,
 * indexed for constant-work lookup on the auth path).
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(), // uuid
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    /** SHA-256 hex of the plaintext key. Unique — one row per key. */
    keyHash: text("key_hash").notNull().unique(),
    /** Leading display portion, e.g. "rag_live_a1b2". Safe to show. */
    keyPrefix: text("key_prefix").notNull(),
    /** Last 4 chars of the key, for UI disambiguation. */
    last4: text("last4").notNull(),
    /** Per-key cap (requests/minute); defaults from config at creation. */
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull(),
    createdAt: epochMs("created_at").notNull(),
    /** Epoch ms of the last successful auth (throttled write); null if unused. */
    lastUsedAt: epochMs("last_used_at"),
    /** Epoch ms when revoked; null while active. Revoked keys fail auth. */
    revokedAt: epochMs("revoked_at"),
  },
  (t) => [index("api_keys_tenant_id_idx").on(t.tenantId)],
);

/**
 * Sliding-window rate-limit state, one row per API key.
 *
 * `hits` holds the epoch-ms timestamps of allowed requests still inside the
 * trailing window. Keeping the whole log (rather than a counter) is what makes
 * the window *sliding*: a fixed window would let a caller fire a full quota at
 * the end of one window and again at the start of the next (~2x burst at the
 * boundary). The array is naturally bounded by the key's limit — once full,
 * further requests are rejected without being recorded.
 *
 * This table is hot-path state, not durable business data: dropping a row just
 * resets that key's window, which is at worst momentarily lenient.
 */
export const rateLimits = pgTable("rate_limits", {
  /** API key id (`api_keys.id`). One limiter per key. */
  keyId: text("key_id").primaryKey(),
  /** Epoch-ms timestamps of allowed hits inside the window, ascending. */
  hits: bigint("hits", { mode: "number" }).array().notNull().default([]),
  updatedAt: epochMs("updated_at").notNull(),
});

/**
 * Usage analytics events. One row per query / ingestion, written
 * asynchronously OFF the request critical path (via `after()`). SQL
 * aggregation over this table backs the analytics dashboard.
 *
 * Privacy: raw query text is NOT stored by default — only `queryHash` +
 * `queryLength`. Plaintext is gated behind the STORE_RAW_QUERY_TEXT config
 * flag (default off) and lands in `queryText` only when enabled.
 *
 * Indexed for the dashboard aggregations: `(tenant_id, created_at)` is the
 * workhorse composite (every endpoint filters by tenant + time range);
 * secondary indexes support the collection/status groupings.
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(), // uuid
    tenantId: text("tenant_id").notNull(),
    /** 'query' | 'ingestion' — see UsageEventType. */
    eventType: text("event_type").notNull(),
    /** Epoch ms; primary time axis for every aggregation. */
    createdAt: epochMs("created_at").notNull(),
    collectionId: text("collection_id"),
    documentId: text("document_id"),
    /** 'session' | 'apikey' — how the originating request authenticated. */
    authType: text("auth_type").notNull(),
    apiKeyId: text("api_key_id"),
    /** 'success' | 'error' | 'rate_limited' | 'no_results' — UsageEventStatus. */
    status: text("status").notNull(),
    errorCode: text("error_code"),
    // --- Latency, split by pipeline stage (ms) ----------------------------
    latencyTotalMs: integer("latency_total_ms"),
    latencyEmbedMs: integer("latency_embed_ms"),
    latencyRetrievalMs: integer("latency_retrieval_ms"),
    latencyGenerationMs: integer("latency_generation_ms"),
    // --- Retrieval accounting ---------------------------------------------
    chunksRetrieved: integer("chunks_retrieved"),
    topScore: doublePrecision("top_score"),
    // --- Token accounting + cost ------------------------------------------
    tokensPrompt: integer("tokens_prompt"),
    tokensCompletion: integer("tokens_completion"),
    estimatedCost: doublePrecision("estimated_cost"),
    // --- Query privacy: hash + length, never raw text (unless flagged) ----
    queryHash: text("query_hash"),
    queryLength: integer("query_length"),
    /** Plaintext query — populated ONLY when STORE_RAW_QUERY_TEXT is enabled. */
    queryText: text("query_text"),
    // --- Ingestion-only accounting ----------------------------------------
    bytesProcessed: bigint("bytes_processed", { mode: "number" }),
    chunkCount: integer("chunk_count"),
  },
  (t) => [
    // Workhorse: every endpoint filters tenant + time range.
    index("usage_events_tenant_created_idx").on(t.tenantId, t.createdAt),
    // Collection filter + "by collection" breakdown within a tenant/range.
    index("usage_events_tenant_collection_idx").on(t.tenantId, t.collectionId),
    // Splits the query vs ingestion streams within a tenant/range.
    index("usage_events_tenant_type_idx").on(t.tenantId, t.eventType),
  ],
);

export type CollectionRow = typeof collections.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type UsageEventRow = typeof usageEvents.$inferSelect;
export type NewUsageEventRow = typeof usageEvents.$inferInsert;

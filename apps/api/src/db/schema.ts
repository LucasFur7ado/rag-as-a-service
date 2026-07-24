import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * D1 schema (Drizzle). Metadata only — raw files live in R2 under
 * `tenants/{tenantId}/collections/{collectionId}/documents/{documentId}/{filename}`.
 *
 * Timestamps are stored as epoch milliseconds (integer) to keep the schema
 * SQLite-native and avoid TZ ambiguity.
 */

export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(), // uuid
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("collections_tenant_id_idx").on(t.tenantId)],
);

export const documents = sqliteTable(
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
    r2Key: text("r2_key").notNull(),
    /** 'uploaded' | 'processing' | 'ready' | 'error' — see DocumentStatus. */
    status: text("status").notNull().default("uploaded"),
    error: text("error"),
    /** Number of chunks indexed by the last successful ingestion run. */
    chunkCount: integer("chunk_count"),
    /** Epoch ms of the last successful ingestion run. */
    ingestedAt: integer("ingested_at"),
    /** Id of the most recent ingestion Workflow instance (observability). */
    workflowInstanceId: text("workflow_instance_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("documents_collection_id_idx").on(t.collectionId),
    index("documents_tenant_id_idx").on(t.tenantId),
  ],
);

/**
 * API keys (Feature 4). The plaintext key is NEVER stored — only its SHA-256
 * hash (unique, indexed for constant-work lookup on the auth path). A KV entry
 * keyed by the same hash mirrors the auth-relevant fields for fast reads; D1
 * stays the source of truth for listing/management.
 */
export const apiKeys = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
    /** Epoch ms of the last successful auth (throttled write); null if unused. */
    lastUsedAt: integer("last_used_at"),
    /** Epoch ms when revoked; null while active. Revoked keys fail auth. */
    revokedAt: integer("revoked_at"),
  },
  (t) => [
    index("api_keys_tenant_id_idx").on(t.tenantId),
    index("api_keys_key_hash_idx").on(t.keyHash),
  ],
);

/**
 * Usage analytics events (Feature 5). One row per query / ingestion, written
 * asynchronously OFF the request critical path (via ctx.waitUntil). SQL
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
export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(), // uuid
    tenantId: text("tenant_id").notNull(),
    /** 'query' | 'ingestion' — see UsageEventType. */
    eventType: text("event_type").notNull(),
    /** Epoch ms; primary time axis for every aggregation. */
    createdAt: integer("created_at").notNull(),
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
    topScore: real("top_score"),
    // --- Token accounting + cost ------------------------------------------
    tokensPrompt: integer("tokens_prompt"),
    tokensCompletion: integer("tokens_completion"),
    estimatedCost: real("estimated_cost"),
    // --- Query privacy: hash + length, never raw text (unless flagged) ----
    queryHash: text("query_hash"),
    queryLength: integer("query_length"),
    /** Plaintext query — populated ONLY when STORE_RAW_QUERY_TEXT is enabled. */
    queryText: text("query_text"),
    // --- Ingestion-only accounting ----------------------------------------
    bytesProcessed: integer("bytes_processed"),
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

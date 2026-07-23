import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export type CollectionRow = typeof collections.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;

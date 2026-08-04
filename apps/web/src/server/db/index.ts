import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import type { Collection, Document, DocumentStatus } from "@rag/shared";
import { databaseUrl } from "../env";
import * as schema from "./schema";
import type { CollectionRow, DocumentRow } from "./schema";

/**
 * Neon Postgres handle (Drizzle over the serverless HTTP driver).
 *
 * The HTTP driver is the right fit for Vercel Functions: each query is a
 * stateless fetch, so there is no connection to keep alive across invocations
 * and no pool to exhaust when the platform scales out. The trade-off is no
 * interactive transactions — nothing here needs one, and the single place that
 * wants atomicity (the rate limiter) gets it from a per-key advisory lock
 * inside a single statement instead. See services/ratelimit.ts.
 */

let cached: ReturnType<typeof create> | null = null;

function create() {
  return drizzle(neon(databaseUrl()), { schema });
}

/** The shared Drizzle handle. Memoized per warm function instance. */
export function getDb() {
  if (!cached) cached = create();
  return cached;
}

export type Db = ReturnType<typeof getDb>;

/**
 * Load a collection only if it belongs to the tenant; otherwise null.
 * The tenant-scoping primitive shared by every route that addresses a
 * collection — a foreign collection is indistinguishable from a missing one.
 */
export async function findOwnedCollection(
  db: Db,
  tenantId: string,
  collectionId: string,
): Promise<CollectionRow | null> {
  const [row] = await db
    .select()
    .from(schema.collections)
    .where(
      and(
        eq(schema.collections.id, collectionId),
        eq(schema.collections.tenantId, tenantId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Load a document only if it belongs to the tenant; otherwise null. */
export async function findOwnedDocument(
  db: Db,
  tenantId: string,
  documentId: string,
): Promise<DocumentRow | null> {
  const [row] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.tenantId, tenantId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// --- Row → API shape serializers ------------------------------------------
// Postgres uses NULL where the API contract uses absent/undefined, and
// `status` is a plain text column that the app narrows to the DocumentStatus
// union.

export function toCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    tenantId: row.tenantId,
    collectionId: row.collectionId,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status as DocumentStatus,
    error: row.error ?? undefined,
    chunkCount: row.chunkCount ?? undefined,
    ingestedAt: row.ingestedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

import { drizzle } from "drizzle-orm/d1";
import type { Collection, Document, DocumentStatus } from "@rag/shared";
import type { Env } from "../env";
import * as schema from "./schema";
import type { CollectionRow, DocumentRow } from "./schema";

/** Typed Drizzle handle over the D1 binding. */
export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;

// --- Row → API shape serializers ------------------------------------------
// D1 uses NULL where the API contract uses absent/undefined, and `status` is
// a plain text column that the app narrows to the DocumentStatus union.

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

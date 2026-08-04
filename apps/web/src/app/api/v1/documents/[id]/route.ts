import { eq } from "drizzle-orm";
import { rateLimitHeaders, requireAuth } from "@/server/lib/auth";
import { handler, json, noContent, preflight } from "@/server/lib/http";
import { notFound } from "@/server/lib/errors";
import { findOwnedDocument, getDb, toDocument } from "@/server/db";
import { documents as documentsTable } from "@/server/db/schema";
import { deleteByPrefix, documentPrefix } from "@/server/lib/blob";
import { PineconeVectorStore, vectorNamespace } from "@/server/services/vectorstore";

/**
 * Single-document operations (protected, tenant-scoped). Upload/list are
 * addressed through the parent collection and live under
 * `/api/v1/collections/:id/documents`.
 *
 * Every query filters by the authenticated `tenantId`; a document owned by
 * another tenant returns 404 (never a 403 that would leak existence).
 */

type Ctx = { params: Promise<{ id: string }> };

// --- GET /api/v1/documents/:id ----------------------------------------------
export const GET = handler(async (req, ctx: Ctx) => {
  const { auth, rateLimit } = await requireAuth(req);
  const { id } = await ctx.params;
  const row = await findOwnedDocument(getDb(), auth.tenantId, id);
  if (!row) throw notFound("Document not found");

  return json(
    { document: toDocument(row) },
    200,
    rateLimit ? rateLimitHeaders(rateLimit) : {},
  );
});

// --- DELETE /api/v1/documents/:id -------------------------------------------
export const DELETE = handler(async (req, ctx: Ctx) => {
  const { auth, rateLimit } = await requireAuth(req);
  const { id } = await ctx.params;
  const db = getDb();
  const row = await findOwnedDocument(db, auth.tenantId, id);
  if (!row) throw notFound("Document not found");

  // A concurrently-running ingestion is made harmless rather than terminated:
  // its finalize/error writes are scoped to `ingestion_run_id` AND to this row,
  // which is deleted below, so they match nothing. See services/ingest.ts.
  //
  // Vectors first, then files, then the row — a failure at any point leaves the
  // row (and therefore a retryable delete) intact.
  const store = new PineconeVectorStore();
  await store.deleteByDocument(
    vectorNamespace(auth.tenantId, row.collectionId),
    row.id,
  );
  await deleteByPrefix(documentPrefix(row.blobPath));
  await db.delete(documentsTable).where(eq(documentsTable.id, row.id));

  return noContent(rateLimit ? rateLimitHeaders(rateLimit) : {});
});

export const OPTIONS = preflight;

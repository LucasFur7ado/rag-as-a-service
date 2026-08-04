import { eq, inArray } from "drizzle-orm";
import { rateLimitHeaders, requireAuth } from "@/server/lib/auth";
import { handler, json, noContent, preflight } from "@/server/lib/http";
import { notFound } from "@/server/lib/errors";
import { findOwnedCollection, getDb, toCollection } from "@/server/db";
import {
  collections as collectionsTable,
  documents as documentsTable,
} from "@/server/db/schema";
import { collectionPrefix, deleteByPrefix } from "@/server/lib/blob";
import { PineconeVectorStore, vectorNamespace } from "@/server/services/vectorstore";

type Ctx = { params: Promise<{ id: string }> };

// --- GET /api/v1/collections/:id --------------------------------------------
export const GET = handler(async (req, ctx: Ctx) => {
  const { auth, rateLimit } = await requireAuth(req);
  const { id } = await ctx.params;
  const row = await findOwnedCollection(getDb(), auth.tenantId, id);
  if (!row) throw notFound("Collection not found");

  return json(
    { collection: toCollection(row) },
    200,
    rateLimit ? rateLimitHeaders(rateLimit) : {},
  );
});

// --- DELETE /api/v1/collections/:id -----------------------------------------
// Deletes the collection, its document rows, its stored files and its vectors.
export const DELETE = handler(async (req, ctx: Ctx) => {
  const { auth, rateLimit } = await requireAuth(req);
  const { id } = await ctx.params;
  const db = getDb();
  const row = await findOwnedCollection(db, auth.tenantId, id);
  if (!row) throw notFound("Collection not found");

  const docs = await db
    .select({ id: documentsTable.id })
    .from(documentsTable)
    .where(eq(documentsTable.collectionId, row.id));

  // A still-running ingestion can no longer be terminated (there is no
  // instance handle without Workflows), so instead it is made harmless: its
  // final writes are scoped to `ingestion_run_id`, and the row it would update
  // is deleted below — the update then matches nothing. See services/ingest.ts.
  //
  // Vectors first, then files, then the rows — a failure at any point leaves
  // the rows (and therefore a retryable delete) intact. The whole collection
  // maps to one Pinecone namespace and one blob prefix, so both are single
  // sweeps.
  const store = new PineconeVectorStore();
  await store.deleteNamespace(vectorNamespace(auth.tenantId, row.id));
  await deleteByPrefix(collectionPrefix(auth.tenantId, row.id));
  if (docs.length > 0) {
    await db.delete(documentsTable).where(
      inArray(
        documentsTable.id,
        docs.map((d) => d.id),
      ),
    );
  }
  await db.delete(collectionsTable).where(eq(collectionsTable.id, row.id));

  return noContent(rateLimit ? rateLimitHeaders(rateLimit) : {});
});

export const OPTIONS = preflight;

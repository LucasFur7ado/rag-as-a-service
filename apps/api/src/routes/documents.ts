import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import type { DocumentStatusResponse } from "@rag/shared";
import type { AppBindings } from "../env";
import { requireAuth } from "../lib/auth";
import { getDb, toDocument } from "../db";
import { documents as documentsTable } from "../db/schema";
import { deleteByPrefix, documentPrefix } from "../lib/r2";
import { PineconeVectorStore, vectorNamespace } from "../services/vectorstore";

/**
 * Documents API (protected, tenant-scoped) — single-document operations.
 * Upload/list are addressed through the parent collection and live in
 * routes/collections.ts (`/v1/collections/:id/documents`).
 *
 * Every query filters by the authenticated `tenantId`; a document owned by
 * another tenant returns 404 (never a 403 that would leak existence).
 */
export const documents = new Hono<AppBindings>();

documents.use("*", requireAuth);

/** Load a document only if it belongs to the tenant; otherwise null. */
async function findOwnedDocument(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  documentId: string,
) {
  const [row] = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.id, documentId),
        eq(documentsTable.tenantId, tenantId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// --- GET /v1/documents/:id -------------------------------------------------
documents.get("/:id", async (c) => {
  const { tenantId } = c.get("auth");
  const row = await findOwnedDocument(getDb(c.env), tenantId, c.req.param("id"));
  if (!row) throw new HTTPException(404, { message: "Document not found" });

  return c.json({ document: toDocument(row) });
});

// --- GET /v1/documents/:id/status ------------------------------------------
// Lightweight polling endpoint for ingestion progress.
documents.get("/:id/status", async (c) => {
  const { tenantId } = c.get("auth");
  const row = await findOwnedDocument(getDb(c.env), tenantId, c.req.param("id"));
  if (!row) throw new HTTPException(404, { message: "Document not found" });

  const body: DocumentStatusResponse = {
    status: toDocument(row).status,
    chunkCount: row.chunkCount ?? undefined,
    error: row.error ?? undefined,
    updatedAt: row.updatedAt,
  };
  return c.json(body);
});

// --- POST /v1/documents/:id/reingest ----------------------------------------
// Re-runs the ingestion pipeline (e.g. after tuning chunking constants).
// Safe to repeat: vector ids are deterministic, so a re-run overwrites the
// document's vectors instead of duplicating them.
documents.post("/:id/reingest", async (c) => {
  const auth = c.get("auth");
  const { tenantId } = auth;
  const row = await findOwnedDocument(getDb(c.env), tenantId, c.req.param("id"));
  if (!row) throw new HTTPException(404, { message: "Document not found" });
  if (row.status === "processing") {
    throw new HTTPException(409, { message: "Document is already being processed" });
  }

  await c.env.INGEST_QUEUE.send({
    tenantId,
    collectionId: row.collectionId,
    documentId: row.id,
    authType: auth.authType,
    apiKeyId: auth.keyId ?? null,
  });

  return c.json({ document: toDocument(row) }, 202);
});

// --- GET /v1/documents/:id/raw ---------------------------------------------
// Streams the original uploaded file back from R2.
documents.get("/:id/raw", async (c) => {
  const { tenantId } = c.get("auth");
  const row = await findOwnedDocument(getDb(c.env), tenantId, c.req.param("id"));
  if (!row) throw new HTTPException(404, { message: "Document not found" });

  const object = await c.env.RAW_DOCS.get(row.r2Key);
  if (!object) {
    // Metadata exists but the object is gone — surface as missing.
    throw new HTTPException(404, { message: "Document not found" });
  }

  // RFC 6266/5987: ASCII fallback + UTF-8 encoded filename.
  const asciiName = row.filename.replace(/["\\]/g, "_");
  return c.body(object.body, 200, {
    "Content-Type": row.contentType,
    "Content-Length": String(object.size),
    "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
    ETag: object.httpEtag,
  });
});

// --- DELETE /v1/documents/:id ----------------------------------------------
documents.delete("/:id", async (c) => {
  const { tenantId } = c.get("auth");
  const db = getDb(c.env);
  const row = await findOwnedDocument(db, tenantId, c.req.param("id"));
  if (!row) throw new HTTPException(404, { message: "Document not found" });

  // Stop a still-running ingestion so it doesn't race the delete. Best-effort:
  // the instance may already be settled or past its retention period.
  if (row.workflowInstanceId && row.status === "processing") {
    try {
      const instance = await c.env.INGEST_WORKFLOW.get(row.workflowInstanceId);
      await instance.terminate();
    } catch {
      // Instance not found / already finished — nothing to stop.
    }
  }

  // Vectors first, then R2, then D1 — a failure at any point leaves the row
  // (and therefore a retryable delete) intact.
  const store = new PineconeVectorStore(c.env);
  await store.deleteByDocument(
    vectorNamespace(tenantId, row.collectionId),
    row.id,
  );
  // The document's whole R2 folder: raw file + any ingestion staging.
  await deleteByPrefix(c.env.RAW_DOCS, documentPrefix(row.r2Key));
  await db.delete(documentsTable).where(eq(documentsTable.id, row.id));

  return c.body(null, 204);
});

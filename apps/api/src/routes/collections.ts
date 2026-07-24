import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { desc, eq, inArray } from "drizzle-orm";
import type { CreateCollectionRequest } from "@rag/shared";
import type { AppBindings } from "../env";
import { requireAuth } from "../lib/auth";
import { findOwnedCollection, getDb, toCollection, toDocument } from "../db";
import { collections as collectionsTable, documents as documentsTable } from "../db/schema";
import { deleteByPrefix } from "../lib/r2";
import { PineconeVectorStore, vectorNamespace } from "../services/vectorstore";

/**
 * Collections API (protected, tenant-scoped).
 *
 * Every query filters by the authenticated `tenantId`; a resource owned by
 * another tenant is indistinguishable from a missing one (404 — never a
 * 403 that would leak existence).
 *
 * Document upload/list live here too because they are addressed through the
 * parent collection (`/v1/collections/:id/documents`).
 */
export const collections = new Hono<AppBindings>();

collections.use("*", requireAuth);

/** Max accepted upload size. Configurable; default 25 MB. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Accepted upload MIME types. */
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
]);

/** Fallback when the browser sends no/generic MIME type (common for .md). */
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

/**
 * Resolve the effective content type of an upload, or null when the file is
 * not an accepted type. Extension wins over a missing/`application/octet-stream`
 * browser-provided type.
 */
function resolveContentType(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const declared = file.type.split(";")[0].trim().toLowerCase();
  if (ALLOWED_CONTENT_TYPES.has(declared)) return declared;
  if (!declared || declared === "application/octet-stream") {
    return EXTENSION_CONTENT_TYPES[ext] ?? null;
  }
  return null;
}

/** Strip any path components / control chars so the filename is R2-key safe. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean || "file";
}

// --- POST /v1/collections --------------------------------------------------
collections.post("/", async (c) => {
  const { tenantId } = c.get("auth");

  let body: CreateCollectionRequest;
  try {
    body = await c.req.json<CreateCollectionRequest>();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    throw new HTTPException(400, { message: "`name` is required" });
  }
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    tenantId,
    name,
    description,
    createdAt: now,
    updatedAt: now,
  };
  await getDb(c.env).insert(collectionsTable).values(row);

  return c.json({ collection: toCollection(row) }, 201);
});

// --- GET /v1/collections ---------------------------------------------------
collections.get("/", async (c) => {
  const { tenantId } = c.get("auth");
  const rows = await getDb(c.env)
    .select()
    .from(collectionsTable)
    .where(eq(collectionsTable.tenantId, tenantId))
    .orderBy(desc(collectionsTable.createdAt));

  return c.json({ collections: rows.map(toCollection) });
});

// --- GET /v1/collections/:id -----------------------------------------------
collections.get("/:id", async (c) => {
  const { tenantId } = c.get("auth");
  const row = await findOwnedCollection(getDb(c.env), tenantId, c.req.param("id"));
  if (!row) throw new HTTPException(404, { message: "Collection not found" });

  return c.json({ collection: toCollection(row) });
});

// --- DELETE /v1/collections/:id --------------------------------------------
// Deletes the collection, its document rows, and their R2 objects.
collections.delete("/:id", async (c) => {
  const { tenantId } = c.get("auth");
  const db = getDb(c.env);
  const row = await findOwnedCollection(db, tenantId, c.req.param("id"));
  if (!row) throw new HTTPException(404, { message: "Collection not found" });

  const docs = await db
    .select({
      id: documentsTable.id,
      status: documentsTable.status,
      workflowInstanceId: documentsTable.workflowInstanceId,
    })
    .from(documentsTable)
    .where(eq(documentsTable.collectionId, row.id));

  // Stop still-running ingestions so they don't race the delete (best-effort).
  for (const doc of docs) {
    if (doc.workflowInstanceId && doc.status === "processing") {
      try {
        const instance = await c.env.INGEST_WORKFLOW.get(doc.workflowInstanceId);
        await instance.terminate();
      } catch {
        // Instance not found / already finished — nothing to stop.
      }
    }
  }

  // Vectors first, then R2, then D1 — a failure at any point leaves the rows
  // (and therefore a retryable delete) intact. The whole collection maps to
  // one Pinecone namespace and one R2 prefix, so both are single sweeps.
  const store = new PineconeVectorStore(c.env);
  await store.deleteNamespace(vectorNamespace(tenantId, row.id));
  await deleteByPrefix(
    c.env.RAW_DOCS,
    `tenants/${tenantId}/collections/${row.id}/`,
  );
  if (docs.length > 0) {
    await db
      .delete(documentsTable)
      .where(
        inArray(
          documentsTable.id,
          docs.map((d) => d.id),
        ),
      );
  }
  await db.delete(collectionsTable).where(eq(collectionsTable.id, row.id));

  return c.body(null, 204);
});

// --- POST /v1/collections/:id/documents ------------------------------------
// multipart/form-data upload, field `file`. Stores the raw file in R2 and a
// metadata row in D1 with status 'uploaded'.
//
// The file is received through the Worker and written to R2 in one pass. A
// future optimization is returning a presigned R2 URL so the browser uploads
// directly and the Worker only records metadata.
collections.post("/:id/documents", async (c) => {
  const auth = c.get("auth");
  const { tenantId } = auth;
  const db = getDb(c.env);
  const collection = await findOwnedCollection(db, tenantId, c.req.param("id"));
  if (!collection) throw new HTTPException(404, { message: "Collection not found" });

  // Cheap early reject before buffering the multipart body.
  const contentLength = Number(c.req.header("Content-Length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES + 16 * 1024) {
    throw new HTTPException(413, {
      message: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`,
    });
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new HTTPException(400, { message: "Expected multipart/form-data" });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: "Missing `file` field" });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HTTPException(413, {
      message: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`,
    });
  }

  const contentType = resolveContentType(file);
  if (!contentType) {
    throw new HTTPException(415, {
      message: "Unsupported file type. Accepted: PDF, plain text, Markdown",
    });
  }

  const documentId = crypto.randomUUID();
  const filename = sanitizeFilename(file.name);
  const r2Key = `tenants/${tenantId}/collections/${collection.id}/documents/${documentId}/${filename}`;

  await c.env.RAW_DOCS.put(r2Key, file, {
    httpMetadata: { contentType },
  });

  const now = Date.now();
  const row = {
    id: documentId,
    collectionId: collection.id,
    tenantId,
    filename,
    contentType,
    sizeBytes: file.size,
    r2Key,
    status: "uploaded" as const,
    error: null,
    chunkCount: null,
    ingestedAt: null,
    workflowInstanceId: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(documentsTable).values(row);

  // Kick off async ingestion: the queue consumer (src/index.ts) starts an
  // IngestWorkflow instance per message. Enqueue failures don't fail the
  // upload — the file and row are safely stored, and the user can trigger
  // ingestion again via POST /v1/documents/:id/reingest.
  try {
    await c.env.INGEST_QUEUE.send({
      tenantId,
      collectionId: collection.id,
      documentId,
      authType: auth.authType,
      apiKeyId: auth.keyId ?? null,
    });
  } catch (err) {
    console.error(`Failed to enqueue ingestion for document ${documentId}:`, err);
  }

  return c.json({ document: toDocument(row) }, 201);
});

// --- GET /v1/collections/:id/documents -------------------------------------
collections.get("/:id/documents", async (c) => {
  const { tenantId } = c.get("auth");
  const db = getDb(c.env);
  const collection = await findOwnedCollection(db, tenantId, c.req.param("id"));
  if (!collection) throw new HTTPException(404, { message: "Collection not found" });

  const rows = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.collectionId, collection.id))
    .orderBy(desc(documentsTable.createdAt));

  return c.json({ documents: rows.map(toDocument) });
});

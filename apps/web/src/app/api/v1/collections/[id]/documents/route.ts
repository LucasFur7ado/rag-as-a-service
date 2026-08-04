import { after } from "next/server";
import { desc, eq } from "drizzle-orm";
import { rateLimitHeaders, requireAuth } from "@/server/lib/auth";
import { handler, json, preflight } from "@/server/lib/http";
import { ApiError, badRequest, notFound } from "@/server/lib/errors";
import { findOwnedCollection, getDb, toDocument } from "@/server/db";
import { documents as documentsTable } from "@/server/db/schema";
import { documentBlobPath, putDocument } from "@/server/lib/blob";
import { runIngestion } from "@/server/services/ingest";
import { MAX_UPLOAD_BYTES } from "@/server/config";

/**
 * Documents addressed through their parent collection:
 * upload (`POST`) and list (`GET`).
 *
 * `maxDuration` covers the upload AND the ingestion that `after()` schedules —
 * `after` callbacks run inside the same invocation, bounded by this budget.
 * 300s is the Vercel Pro/Fluid ceiling; on Hobby the platform caps it lower
 * (60s), which is enough for typical documents but can time out on a very
 * large PDF. A run cut short leaves the document in `processing`; "Reprocess"
 * (`POST /api/v1/documents/:id/reingest`) is the recovery path.
 */
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

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

/** Strip any path components / control chars so the filename is key-safe. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // Escaped rather than literal control chars, so no-control-regex is happy.
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean || "file";
}

// --- POST /api/v1/collections/:id/documents ---------------------------------
// multipart/form-data upload, field `file`. Stores the raw file in Vercel Blob
// and a metadata row with status 'uploaded', then kicks off ingestion in the
// background so the response is not held open for it.
export const POST = handler(async (req, ctx: Ctx) => {
  const { auth, rateLimit } = await requireAuth(req);
  const { id } = await ctx.params;
  const db = getDb();
  const collection = await findOwnedCollection(db, auth.tenantId, id);
  if (!collection) throw notFound("Collection not found");

  // Cheap early reject before buffering the multipart body.
  const contentLength = Number(req.headers.get("Content-Length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES + 16 * 1024) {
    throw new ApiError(
      413,
      `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`,
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Expected multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Missing `file` field");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(
      413,
      `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`,
    );
  }

  const contentType = resolveContentType(file);
  if (!contentType) {
    throw new ApiError(
      415,
      "Unsupported file type. Accepted: PDF, plain text, Markdown",
    );
  }

  const documentId = crypto.randomUUID();
  const filename = sanitizeFilename(file.name);
  const blobPath = documentBlobPath(
    auth.tenantId,
    collection.id,
    documentId,
    filename,
  );

  await putDocument(blobPath, file, contentType);

  const now = Date.now();
  const row = {
    id: documentId,
    collectionId: collection.id,
    tenantId: auth.tenantId,
    filename,
    contentType,
    sizeBytes: file.size,
    blobPath,
    status: "uploaded" as const,
    error: null,
    chunkCount: null,
    ingestedAt: null,
    ingestionRunId: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(documentsTable).values(row);

  // Ingest in the background: `after` runs once the response has been sent, so
  // the upload stays fast. `runIngestion` never throws — it records every
  // outcome as the document's terminal status — so nothing here can fail the
  // upload after the file and row are safely stored.
  after(() =>
    runIngestion({
      tenantId: auth.tenantId,
      collectionId: collection.id,
      documentId,
      authType: auth.authType,
      apiKeyId: auth.keyId ?? null,
    }),
  );

  return json(
    { document: toDocument(row) },
    201,
    rateLimit ? rateLimitHeaders(rateLimit) : {},
  );
});

// --- GET /api/v1/collections/:id/documents ----------------------------------
export const GET = handler(async (req, ctx: Ctx) => {
  const { auth, rateLimit } = await requireAuth(req);
  const { id } = await ctx.params;
  const db = getDb();
  const collection = await findOwnedCollection(db, auth.tenantId, id);
  if (!collection) throw notFound("Collection not found");

  const rows = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.collectionId, collection.id))
    .orderBy(desc(documentsTable.createdAt));

  return json(
    { documents: rows.map(toDocument) },
    200,
    rateLimit ? rateLimitHeaders(rateLimit) : {},
  );
});

export const OPTIONS = preflight;

import { rateLimitHeaders, requireAuth } from "@/server/lib/auth";
import { handler, preflight } from "@/server/lib/http";
import { notFound } from "@/server/lib/errors";
import { findOwnedDocument, getDb } from "@/server/db";
import { getDocument } from "@/server/lib/blob";

/**
 * Stream the original uploaded file back.
 *
 * The blob store is private, so this route is the ONLY way to read a document:
 * it authenticates, tenant-scopes the lookup, then proxies the object's stream
 * through the function. Nothing is cached at the edge — the response is
 * per-tenant by construction.
 */
export const GET = handler(
  async (req, ctx: { params: Promise<{ id: string }> }) => {
    const { auth, rateLimit } = await requireAuth(req);
    const { id } = await ctx.params;
    const row = await findOwnedDocument(getDb(), auth.tenantId, id);
    if (!row) throw notFound("Document not found");

    const object = await getDocument(row.blobPath);
    if (!object) {
      // Metadata exists but the object is gone — surface as missing.
      throw notFound("Document not found");
    }

    // RFC 6266/5987: ASCII fallback + UTF-8 encoded filename.
    const asciiName = row.filename.replace(/["\\]/g, "_");
    const headers: Record<string, string> = {
      "Content-Type": row.contentType,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "Cache-Control": "private, no-store",
      ...(rateLimit ? rateLimitHeaders(rateLimit) : {}),
    };
    if (object.size !== null) headers["Content-Length"] = String(object.size);
    if (object.etag) headers.ETag = object.etag;

    return new Response(object.stream, { status: 200, headers });
  },
);

export const OPTIONS = preflight;

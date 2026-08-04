import type { DocumentStatusResponse } from "@rag/shared";
import { rateLimitHeaders, requireAuth } from "@/server/lib/auth";
import { handler, json, preflight } from "@/server/lib/http";
import { notFound } from "@/server/lib/errors";
import { findOwnedDocument, getDb, toDocument } from "@/server/db";

/** Lightweight polling endpoint for ingestion progress. */
export const GET = handler(
  async (req, ctx: { params: Promise<{ id: string }> }) => {
    const { auth, rateLimit } = await requireAuth(req);
    const { id } = await ctx.params;
    const row = await findOwnedDocument(getDb(), auth.tenantId, id);
    if (!row) throw notFound("Document not found");

    const body: DocumentStatusResponse = {
      status: toDocument(row).status,
      chunkCount: row.chunkCount ?? undefined,
      error: row.error ?? undefined,
      updatedAt: row.updatedAt,
    };
    return json(body, 200, rateLimit ? rateLimitHeaders(rateLimit) : {});
  },
);

export const OPTIONS = preflight;

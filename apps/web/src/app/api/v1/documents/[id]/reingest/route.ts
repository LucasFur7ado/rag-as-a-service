import { after } from "next/server";
import { rateLimitHeaders, requireAuth } from "@/server/lib/auth";
import { handler, json, preflight } from "@/server/lib/http";
import { conflict, notFound } from "@/server/lib/errors";
import { findOwnedDocument, getDb, toDocument } from "@/server/db";
import { isStaleProcessing, runIngestion } from "@/server/services/ingest";

/**
 * Re-run the ingestion pipeline (e.g. after tuning chunking constants, or to
 * recover a run that was cut short by the function timeout).
 *
 * Safe to repeat: vector ids are deterministic, so a re-run overwrites the
 * document's vectors instead of duplicating them.
 */
export const maxDuration = 300;

export const POST = handler(
  async (req, ctx: { params: Promise<{ id: string }> }) => {
    const { auth, rateLimit } = await requireAuth(req);
    const { id } = await ctx.params;
    const row = await findOwnedDocument(getDb(), auth.tenantId, id);
    if (!row) throw notFound("Document not found");

    // A document stuck in `processing` past the staleness window is presumed
    // abandoned — its invocation timed out or crashed. Without this escape
    // hatch such a document could never be re-ingested, because the durable
    // Workflow that used to guarantee completion is gone. See services/ingest.ts.
    if (row.status === "processing" && !isStaleProcessing(row.updatedAt)) {
      throw conflict("Document is already being processed");
    }

    after(() =>
      runIngestion({
        tenantId: auth.tenantId,
        collectionId: row.collectionId,
        documentId: row.id,
        authType: auth.authType,
        apiKeyId: auth.keyId ?? null,
      }),
    );

    return json(
      { document: toDocument(row) },
      202,
      rateLimit ? rateLimitHeaders(rateLimit) : {},
    );
  },
);

export const OPTIONS = preflight;

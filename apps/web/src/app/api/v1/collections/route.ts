import { desc, eq } from "drizzle-orm";
import type { CreateCollectionRequest } from "@rag/shared";
import { rateLimitHeaders, requireAuth } from "@/server/lib/auth";
import { handler, json, preflight, readJson } from "@/server/lib/http";
import { badRequest } from "@/server/lib/errors";
import { getDb, toCollection } from "@/server/db";
import { collections as collectionsTable } from "@/server/db/schema";

/**
 * Collections API (protected, tenant-scoped).
 *
 * Every query filters by the authenticated `tenantId`; a resource owned by
 * another tenant is indistinguishable from a missing one (404 — never a 403
 * that would leak existence).
 */

// --- POST /api/v1/collections -----------------------------------------------
export const POST = handler(async (req) => {
  const { auth, rateLimit } = await requireAuth(req);
  const body = await readJson<CreateCollectionRequest>(req);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw badRequest("`name` is required");
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    tenantId: auth.tenantId,
    name,
    description,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().insert(collectionsTable).values(row);

  return json({ collection: toCollection(row) }, 201, rateLimit ? rateLimitHeaders(rateLimit) : {});
});

// --- GET /api/v1/collections ------------------------------------------------
export const GET = handler(async (req) => {
  const { auth, rateLimit } = await requireAuth(req);
  const rows = await getDb()
    .select()
    .from(collectionsTable)
    .where(eq(collectionsTable.tenantId, auth.tenantId))
    .orderBy(desc(collectionsTable.createdAt));

  return json(
    { collections: rows.map(toCollection) },
    200,
    rateLimit ? rateLimitHeaders(rateLimit) : {},
  );
});

export const OPTIONS = preflight;

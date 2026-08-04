import { and, eq } from "drizzle-orm";
import { requireSession } from "@/server/lib/auth";
import { handler, noContent, preflight } from "@/server/lib/http";
import { notFound } from "@/server/lib/errors";
import { getDb } from "@/server/db";
import { apiKeys as apiKeysTable } from "@/server/db/schema";

/**
 * Revoke (soft delete) an API key: set `revoked_at`.
 *
 * Revocation is **immediate**. The Workers version also had to purge a KV
 * cache entry — best-effort, with a TTL as the backstop for a failed purge —
 * because the auth fast path short-circuited on a cache hit and never consulted
 * the database. There is no cache here (see resolveApiKey in lib/auth.ts), so
 * the next request re-reads this row and rejects the key. Nothing to purge,
 * nothing to expire, no window in which a revoked key still works.
 */
export const DELETE = handler(
  async (req, ctx: { params: Promise<{ id: string }> }) => {
    const { auth } = await requireSession(req);
    const { id } = await ctx.params;
    const db = getDb();

    const [row] = await db
      .select({ id: apiKeysTable.id, revokedAt: apiKeysTable.revokedAt })
      .from(apiKeysTable)
      .where(
        and(eq(apiKeysTable.id, id), eq(apiKeysTable.tenantId, auth.tenantId)),
      )
      .limit(1);
    if (!row) throw notFound("API key not found");

    if (row.revokedAt === null) {
      await db
        .update(apiKeysTable)
        .set({ revokedAt: Date.now() })
        .where(eq(apiKeysTable.id, row.id));
    }

    return noContent();
  },
);

export const OPTIONS = preflight;

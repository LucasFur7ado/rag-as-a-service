import { requireSession } from "@/server/lib/auth";
import { handler, json, preflight } from "@/server/lib/http";
import { parseRange } from "@/server/lib/analytics-params";
import { getDb } from "@/server/db";
import { getBreakdown } from "@/server/services/analytics-queries";

/**
 * Analytics API — the dashboard's data source.
 *
 * SESSION-ONLY: analytics is a dashboard feature, not part of the public API,
 * so every endpoint sits behind `requireSession`. An API key presented here is
 * a 401 — programmatic clients can never read usage analytics through this
 * surface.
 *
 * Every endpoint is tenant-scoped (the tenant comes from the verified session,
 * never from the client) and accepts `from`, `to` (epoch ms or ISO) plus an
 * optional `collectionId`. All aggregation happens in SQL
 * (server/services/analytics-queries.ts); handlers only parse params and shape
 * JSON.
 */

export const GET = handler(async (req) => {
  const { auth } = await requireSession(req);
  return json(await getBreakdown(getDb(), parseRange(req, auth)));
});

export const OPTIONS = preflight;

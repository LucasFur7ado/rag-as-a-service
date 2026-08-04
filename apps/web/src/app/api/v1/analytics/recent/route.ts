import { requireSession } from "@/server/lib/auth";
import { handler, json, preflight } from "@/server/lib/http";
import { parseRange } from "@/server/lib/analytics-params";
import type { UsageEventStatus } from "@rag/shared";
import { getRecentEvents } from "@/server/services/analytics-queries";

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

/** Hard cap on a `recent` page size. */
const MAX_RECENT_LIMIT = 100;
const DEFAULT_RECENT_LIMIT = 25;

const VALID_STATUSES: UsageEventStatus[] = [
  "success",
  "error",
  "rate_limited",
  "no_results",
];

export const GET = handler(async (req) => {
  const { auth } = await requireSession(req);
  const range = parseRange(req, auth);
  const params = new URL(req.url).searchParams;

  const statusParam = params.get("status");
  const status = VALID_STATUSES.includes(statusParam as UsageEventStatus)
    ? (statusParam as UsageEventStatus)
    : undefined;

  const rawLimit = Number(params.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.max(Math.floor(rawLimit), 1), MAX_RECENT_LIMIT)
    : DEFAULT_RECENT_LIMIT;

  return json(
    await getRecentEvents({
      ...range,
      status,
      limit,
      cursor: params.get("cursor") || null,
    }),
  );
});

export const OPTIONS = preflight;

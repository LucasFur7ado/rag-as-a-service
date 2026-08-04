import { requireSession } from "@/server/lib/auth";
import { handler, json, preflight } from "@/server/lib/http";
import { parseRange } from "@/server/lib/analytics-params";
import type { TimeseriesGranularity } from "@rag/shared";
import { getTimeseries } from "@/server/services/analytics-queries";

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
  const range = parseRange(req, auth);
  const g = new URL(req.url).searchParams.get("granularity");
  const override: TimeseriesGranularity | undefined =
    g === "hour" || g === "day" ? g : undefined;
  return json(await getTimeseries(range, override));
});

export const OPTIONS = preflight;

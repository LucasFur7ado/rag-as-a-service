import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import type { TimeseriesGranularity, UsageEventStatus } from "@rag/shared";
import type { AppBindings } from "../env";
import { requireSession } from "../lib/auth";
import { getDb } from "../db";
import { ANALYTICS_DEFAULT_RANGE_DAYS } from "../config";
import {
  getBreakdown,
  getIngestionStats,
  getRecentEvents,
  getSummary,
  getTimeseries,
  type RangeFilter,
} from "../services/analytics-queries";

/**
 * Analytics API (Feature 5, Part B) — the dashboard's data source.
 *
 * SESSION-ONLY: analytics is a dashboard feature, not part of the public API,
 * so it is mounted behind {@link requireSession}. An API key presented here is
 * a 401 — programmatic clients can never read another tenant's (or their own)
 * usage analytics through this surface.
 *
 * Every endpoint is tenant-scoped (the tenant comes from the verified session,
 * never from the client) and accepts `from`, `to` (epoch ms or ISO) and an
 * optional `collectionId`. All aggregation happens in SQL
 * (services/analytics-queries.ts); handlers only parse params and shape JSON.
 */
export const analytics = new Hono<AppBindings>();

analytics.use("*", requireSession);

const DAY_MS = 86_400_000;
/** Hard cap on a `recent` page size. */
const MAX_RECENT_LIMIT = 100;
const DEFAULT_RECENT_LIMIT = 25;

/** Parse an epoch-ms or ISO-8601 timestamp; undefined when absent/invalid. */
function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Resolve the shared range + collection filter from the query string. Defaults
 * to the last {@link ANALYTICS_DEFAULT_RANGE_DAYS} days when `from`/`to` are
 * omitted. Rejects an inverted or absurd range with 400.
 */
function parseRange(c: Context<AppBindings>): RangeFilter {
  const { tenantId } = c.get("auth");
  const now = Date.now();
  const to = parseTimestamp(c.req.query("to")) ?? now;
  const from =
    parseTimestamp(c.req.query("from")) ??
    to - ANALYTICS_DEFAULT_RANGE_DAYS * DAY_MS;

  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new HTTPException(400, {
      message: "Invalid range: `from` must be a valid timestamp before `to`",
    });
  }

  const collectionId = c.req.query("collectionId")?.trim() || null;
  return { tenantId, from, to, collectionId };
}

// --- GET /v1/analytics/summary ---------------------------------------------
analytics.get("/summary", async (c) => {
  const range = parseRange(c);
  return c.json(await getSummary(c.env.DB, range));
});

// --- GET /v1/analytics/timeseries ------------------------------------------
analytics.get("/timeseries", async (c) => {
  const range = parseRange(c);
  const g = c.req.query("granularity");
  const override: TimeseriesGranularity | undefined =
    g === "hour" || g === "day" ? g : undefined;
  return c.json(await getTimeseries(c.env.DB, range, override));
});

// --- GET /v1/analytics/breakdown -------------------------------------------
analytics.get("/breakdown", async (c) => {
  const range = parseRange(c);
  return c.json(await getBreakdown(c.env.DB, getDb(c.env), range));
});

// --- GET /v1/analytics/recent ----------------------------------------------
analytics.get("/recent", async (c) => {
  const range = parseRange(c);

  const statusParam = c.req.query("status");
  const validStatuses: UsageEventStatus[] = [
    "success",
    "error",
    "rate_limited",
    "no_results",
  ];
  const status = validStatuses.includes(statusParam as UsageEventStatus)
    ? (statusParam as UsageEventStatus)
    : undefined;

  const rawLimit = Number(c.req.query("limit"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), MAX_RECENT_LIMIT)
    : DEFAULT_RECENT_LIMIT;

  const cursor = c.req.query("cursor") || null;

  return c.json(
    await getRecentEvents(c.env.DB, { ...range, status, limit, cursor }),
  );
});

// --- GET /v1/analytics/ingestion -------------------------------------------
analytics.get("/ingestion", async (c) => {
  const range = parseRange(c);
  return c.json(await getIngestionStats(c.env.DB, range));
});

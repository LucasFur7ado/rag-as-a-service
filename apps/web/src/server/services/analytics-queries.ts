import "server-only";

import type {
  AnalyticsSummary,
  BreakdownCount,
  BreakdownResponse,
  IngestionStats,
  MetricWithDelta,
  StageLatency,
  TimeseriesGranularity,
  TimeseriesPoint,
  TimeseriesResponse,
  UsageEvent,
  UsageEventStatus,
} from "@rag/shared";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { collections as collectionsTable } from "../db/schema";
import { percentileRankSql } from "../lib/percentile";

/**
 * SQL aggregation for the analytics API.
 *
 * Every figure the dashboard shows is computed by the DATABASE — these
 * functions issue GROUP BY / window-function queries and return already-
 * reduced rows. No endpoint ever pulls raw event rows into JS to reduce them
 * (the one exception, `getRecentEvents`, is an intentionally paginated row
 * listing, not an aggregation).
 *
 * Percentiles are computed in SQL via a `ROW_NUMBER()` CTE whose rank filter
 * comes from {@link percentileRankSql} — the single source of truth for the
 * percentile formula (see lib/percentile.ts + its tests).
 *
 * Tenant isolation: `tenant_id = $1` is the first predicate of every query;
 * these functions are only reachable behind session auth (see the routes).
 *
 * Two Postgres-specific rules are followed throughout, and breaking either is
 * silent rather than loud:
 *  1. **Every alias is double-quoted.** Postgres folds unquoted identifiers to
 *     lower case, so `AS totalQueries` would come back as `totalqueries` and
 *     every property read would be `undefined` — a dashboard of zeros on top
 *     of real data.
 *  2. **Every aggregate is cast.** `COUNT`/`SUM` over integers return `bigint`
 *     and `AVG` returns `numeric`; the driver hands both back as *strings* to
 *     preserve precision, so `a + b` would concatenate. Casting to `int`/
 *     `float8` in SQL keeps the wire types numeric, and {@link num} is a
 *     belt-and-braces coercion on the JS side.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Ranges up to this length bucket by hour; longer ranges bucket by day. */
const HOURLY_MAX_RANGE_MS = 3 * DAY_MS;

/** Common range + optional collection filter shared by every query. */
export interface RangeFilter {
  tenantId: string;
  from: number;
  to: number;
  /** Null / undefined → all collections. */
  collectionId?: string | null;
}

// --- Query helpers ----------------------------------------------------------

/** Coerce a driver value that may arrive as a numeric string. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Same, but preserving "absent" as null (for optional averages). */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** One result row, keyed by the quoted aliases in the SELECT. */
type Row = Record<string, unknown>;

async function rows(query: SQL): Promise<Row[]> {
  const result = await getDb().execute<Row>(query);
  if (Array.isArray(result)) return result as Row[];
  const r = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(r) ? (r as Row[]) : [];
}

async function firstRow(query: SQL): Promise<Row | null> {
  return (await rows(query))[0] ?? null;
}

/**
 * The reusable predicate for query events: tenant + range + optional
 * collection. The `::text` cast on the collection parameter is required —
 * without it Postgres cannot infer a type for a bare `$n IS NULL` and rejects
 * the statement outright.
 */
function queryWhere(f: RangeFilter): SQL {
  const cid = f.collectionId ?? null;
  return sql`tenant_id = ${f.tenantId}
    AND event_type = 'query'
    AND created_at >= ${f.from}
    AND created_at < ${f.to}
    AND (${cid}::text IS NULL OR collection_id = ${cid}::text)`;
}

// --- Summary ----------------------------------------------------------------

interface WindowAgg {
  totalQueries: number;
  success: number;
  errorCount: number;
  rateLimited: number;
  totalTokens: number;
  estimatedCost: number;
  activeCollections: number;
}

const EMPTY_AGG: WindowAgg = {
  totalQueries: 0,
  success: 0,
  errorCount: 0,
  rateLimited: 0,
  totalTokens: 0,
  estimatedCost: 0,
  activeCollections: 0,
};

async function windowAggregates(f: RangeFilter): Promise<WindowAgg> {
  const row = await firstRow(sql`
    SELECT
      COUNT(*)::int AS "totalQueries",
      COUNT(*) FILTER (WHERE status = 'success')::int AS "success",
      COUNT(*) FILTER (WHERE status = 'error')::int AS "errorCount",
      COUNT(*) FILTER (WHERE status = 'rate_limited')::int AS "rateLimited",
      COALESCE(SUM(COALESCE(tokens_prompt, 0) + COALESCE(tokens_completion, 0)), 0)::float8 AS "totalTokens",
      COALESCE(SUM(estimated_cost), 0)::float8 AS "estimatedCost",
      COUNT(DISTINCT collection_id)::int AS "activeCollections"
    FROM usage_events
    WHERE ${queryWhere(f)}
  `);
  if (!row) return EMPTY_AGG;
  return {
    totalQueries: num(row.totalQueries),
    success: num(row.success),
    errorCount: num(row.errorCount),
    rateLimited: num(row.rateLimited),
    totalTokens: num(row.totalTokens),
    estimatedCost: num(row.estimatedCost),
    activeCollections: num(row.activeCollections),
  };
}

async function latencyPercentiles(
  f: RangeFilter,
): Promise<{ p50: number; p95: number }> {
  const row = await firstRow(sql`
    WITH q AS (
      SELECT latency_total_ms AS v FROM usage_events
      WHERE ${queryWhere(f)} AND latency_total_ms IS NOT NULL
    ),
    ordered AS (
      SELECT v, ROW_NUMBER() OVER (ORDER BY v) AS rn, COUNT(*) OVER () AS cnt FROM q
    )
    SELECT
      COALESCE(MAX(v) FILTER (WHERE rn = ${sql.raw(percentileRankSql("cnt", 0.5))}), 0)::float8 AS "p50",
      COALESCE(MAX(v) FILTER (WHERE rn = ${sql.raw(percentileRankSql("cnt", 0.95))}), 0)::float8 AS "p95"
    FROM ordered
  `);
  return { p50: num(row?.p50), p95: num(row?.p95) };
}

/** KPI summary for the range plus the immediately-preceding equal-length window. */
export async function getSummary(f: RangeFilter): Promise<AnalyticsSummary> {
  const windowMs = f.to - f.from;
  const prev: RangeFilter = { ...f, from: f.from - windowMs, to: f.from };

  const [cur, prevAgg, curP, prevP] = await Promise.all([
    windowAggregates(f),
    windowAggregates(prev),
    latencyPercentiles(f),
    latencyPercentiles(prev),
  ]);

  const rate = (a: WindowAgg) =>
    a.totalQueries > 0 ? a.success / a.totalQueries : 0;

  const metric = (value: number, previous: number): MetricWithDelta => ({
    value,
    previous,
  });

  return {
    range: { from: f.from, to: f.to },
    totalQueries: metric(cur.totalQueries, prevAgg.totalQueries),
    successRate: metric(rate(cur), rate(prevAgg)),
    p50LatencyMs: metric(curP.p50, prevP.p50),
    p95LatencyMs: metric(curP.p95, prevP.p95),
    totalTokens: metric(cur.totalTokens, prevAgg.totalTokens),
    estimatedCost: metric(cur.estimatedCost, prevAgg.estimatedCost),
    activeCollections: metric(cur.activeCollections, prevAgg.activeCollections),
    errorCount: metric(cur.errorCount, prevAgg.errorCount),
    rateLimitedCount: metric(cur.rateLimited, prevAgg.rateLimited),
  };
}

// --- Timeseries -------------------------------------------------------------

/** Pick hour vs day buckets from the range width (client may override). */
export function pickGranularity(
  from: number,
  to: number,
  override?: TimeseriesGranularity,
): TimeseriesGranularity {
  if (override === "hour" || override === "day") return override;
  return to - from <= HOURLY_MAX_RANGE_MS ? "hour" : "day";
}

/**
 * Floor a timestamp to the start of its bucket. The JS side of the bucket
 * contract — {@link bucketExpr} is the SQL side, and the two MUST agree or the
 * fill loop below silently looks up keys that no aggregate row carries.
 */
export function bucketStart(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}

/**
 * SQL bucket expression: floor `created_at` to a multiple of `bucketMs`.
 *
 * The `::bigint` casts are load-bearing. `created_at` is bigint, but the bound
 * divisor arrives untyped and Postgres would resolve `bigint / $n` through the
 * numeric operator — turning this into *floating-point* division, after which
 * `(x / n) * n` returns `x` unchanged and every event lands in its own bucket,
 * matching none of the boundaries {@link bucketStart} generates. Pinning the
 * divisor to bigint selects integer division. (This is the Postgres analogue
 * of the same trap the SQLite version hit with a REAL-bound divisor.)
 */
export function bucketExpr(bucketMs: number): SQL {
  return sql`(created_at / ${bucketMs}::bigint) * ${bucketMs}::bigint`;
}

export async function getTimeseries(
  f: RangeFilter,
  override?: TimeseriesGranularity,
): Promise<TimeseriesResponse> {
  const granularity = pickGranularity(f.from, f.to, override);
  const bucketMs = granularity === "hour" ? HOUR_MS : DAY_MS;

  // Counts by status + avg latency + tokens/cost, per bucket.
  const counts = await rows(sql`
    SELECT
      ${bucketExpr(bucketMs)} AS "bucket",
      COUNT(*) FILTER (WHERE status = 'success')::int AS "success",
      COUNT(*) FILTER (WHERE status = 'error')::int AS "error",
      COUNT(*) FILTER (WHERE status = 'rate_limited')::int AS "rateLimited",
      COUNT(*) FILTER (WHERE status = 'no_results')::int AS "noResults",
      AVG(latency_total_ms)::float8 AS "avgLatencyMs",
      COALESCE(SUM(COALESCE(tokens_prompt, 0) + COALESCE(tokens_completion, 0)), 0)::float8 AS "tokens",
      COALESCE(SUM(estimated_cost), 0)::float8 AS "estimatedCost"
    FROM usage_events
    WHERE ${queryWhere(f)}
    GROUP BY 1
    ORDER BY 1
  `);

  // p95 latency per bucket (window function partitioned by bucket).
  const p95Rows = await rows(sql`
    WITH q AS (
      SELECT ${bucketExpr(bucketMs)} AS bucket, latency_total_ms AS v
      FROM usage_events
      WHERE ${queryWhere(f)} AND latency_total_ms IS NOT NULL
    ),
    ordered AS (
      SELECT bucket, v,
             ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY v) AS rn,
             COUNT(*) OVER (PARTITION BY bucket) AS cnt
      FROM q
    )
    SELECT bucket AS "bucket",
           MAX(v) FILTER (WHERE rn = ${sql.raw(percentileRankSql("cnt", 0.95))})::float8 AS "p95"
    FROM ordered
    GROUP BY bucket
  `);

  const p95ByBucket = new Map(p95Rows.map((r) => [num(r.bucket), numOrNull(r.p95)]));
  const countsByBucket = new Map(counts.map((r) => [num(r.bucket), r]));

  // Emit a CONTINUOUS series: fill empty buckets so the chart has no gaps.
  // Merging already-aggregated buckets is not "reducing raw rows".
  const points: TimeseriesPoint[] = [];
  const firstBucket = bucketStart(f.from, bucketMs);
  const lastBucket = bucketStart(f.to - 1, bucketMs);
  for (let b = firstBucket; b <= lastBucket; b += bucketMs) {
    const row = countsByBucket.get(b);
    points.push({
      bucket: b,
      success: num(row?.success),
      error: num(row?.error),
      rateLimited: num(row?.rateLimited),
      noResults: num(row?.noResults),
      avgLatencyMs: row ? numOrNull(row.avgLatencyMs) : null,
      p95LatencyMs: p95ByBucket.get(b) ?? null,
      tokens: num(row?.tokens),
      estimatedCost: num(row?.estimatedCost),
    });
  }

  return { granularity, points };
}

// --- Breakdown --------------------------------------------------------------

async function groupCounts(
  f: RangeFilter,
  column: SQL,
  extra?: SQL,
): Promise<{ key: string; count: number }[]> {
  const result = await rows(sql`
    SELECT ${column} AS "key", COUNT(*)::int AS "count"
    FROM usage_events
    WHERE ${queryWhere(f)}${extra ? sql` AND ${extra}` : sql``}
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  return result.map((r) => ({ key: String(r.key), count: num(r.count) }));
}

export async function getBreakdown(
  drizzle: Db,
  f: RangeFilter,
): Promise<BreakdownResponse> {
  const [byCollectionRaw, byStatus, byAuthType, stage] = await Promise.all([
    groupCounts(f, sql`collection_id`, sql`collection_id IS NOT NULL`),
    groupCounts(f, sql`status`),
    groupCounts(f, sql`auth_type`),
    firstRow(sql`
      SELECT AVG(latency_embed_ms)::float8 AS "embed",
             AVG(latency_retrieval_ms)::float8 AS "retrieval",
             AVG(latency_generation_ms)::float8 AS "generation"
      FROM usage_events
      WHERE ${queryWhere(f)}
    `),
  ]);

  // Resolve collection names for the grouping labels (tenant-scoped).
  const ids = byCollectionRaw.map((r) => r.key);
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const found = await drizzle
      .select({ id: collectionsTable.id, name: collectionsTable.name })
      .from(collectionsTable)
      .where(
        and(
          eq(collectionsTable.tenantId, f.tenantId),
          inArray(collectionsTable.id, ids),
        ),
      );
    for (const r of found) nameById.set(r.id, r.name);
  }

  const byCollection: BreakdownCount[] = byCollectionRaw.map((r) => ({
    key: r.key,
    label: nameById.get(r.key) ?? "(deleted collection)",
    count: r.count,
  }));

  const labeled = (list: { key: string; count: number }[]): BreakdownCount[] =>
    list.map((r) => ({ key: r.key, label: r.key, count: r.count }));

  const stageLatency: StageLatency = {
    embed: numOrNull(stage?.embed),
    retrieval: numOrNull(stage?.retrieval),
    generation: numOrNull(stage?.generation),
  };

  return {
    byCollection,
    byStatus: labeled(byStatus),
    byAuthType: labeled(byAuthType),
    stageLatency,
  };
}

// --- Recent (paginated drill-down; NOT an aggregation) ----------------------

export interface RecentFilter extends RangeFilter {
  status?: UsageEventStatus;
  limit: number;
  /** `${createdAt}_${id}` of the last row on the previous page. */
  cursor?: string | null;
}

function toUsageEvent(r: Record<string, unknown>): UsageEvent {
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    eventType: r.event_type as UsageEvent["eventType"],
    createdAt: num(r.created_at),
    collectionId: (r.collection_id as string | null) ?? null,
    documentId: (r.document_id as string | null) ?? null,
    authType: r.auth_type as UsageEvent["authType"],
    apiKeyId: (r.api_key_id as string | null) ?? null,
    status: r.status as UsageEventStatus,
    errorCode: (r.error_code as string | null) ?? null,
    latencyTotalMs: numOrNull(r.latency_total_ms),
    latencyEmbedMs: numOrNull(r.latency_embed_ms),
    latencyRetrievalMs: numOrNull(r.latency_retrieval_ms),
    latencyGenerationMs: numOrNull(r.latency_generation_ms),
    chunksRetrieved: numOrNull(r.chunks_retrieved),
    topScore: numOrNull(r.top_score),
    tokensPrompt: numOrNull(r.tokens_prompt),
    tokensCompletion: numOrNull(r.tokens_completion),
    estimatedCost: numOrNull(r.estimated_cost),
    queryLength: numOrNull(r.query_length),
    bytesProcessed: numOrNull(r.bytes_processed),
    chunkCount: numOrNull(r.chunk_count),
    queryText: (r.query_text as string | null) ?? null,
  };
}

export async function getRecentEvents(
  f: RecentFilter,
): Promise<{ events: UsageEvent[]; nextCursor: string | null }> {
  const cid = f.collectionId ?? null;
  // Note this predicate spans BOTH event types (unlike queryWhere): the
  // drill-down table lists ingestion runs alongside queries.
  let where = sql`tenant_id = ${f.tenantId}
    AND created_at >= ${f.from}
    AND created_at < ${f.to}
    AND (${cid}::text IS NULL OR collection_id = ${cid}::text)`;

  if (f.status) {
    where = sql`${where} AND status = ${f.status}`;
  }
  if (f.cursor) {
    // Keyset pagination on (created_at, id) DESC — stable and index-friendly.
    const [cAt, cId] = f.cursor.split("_");
    const at = Number(cAt);
    if (Number.isFinite(at) && cId) {
      where = sql`${where} AND (created_at, id) < (${at}::bigint, ${cId}::text)`;
    }
  }

  // Fetch one extra row to detect a next page.
  const page = await rows(sql`
    SELECT * FROM usage_events
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ${f.limit + 1}
  `);

  const hasMore = page.length > f.limit;
  const trimmed = hasMore ? page.slice(0, f.limit) : page;
  const last = trimmed[trimmed.length - 1];
  const nextCursor =
    hasMore && last ? `${num(last.created_at)}_${String(last.id)}` : null;

  return { events: trimmed.map(toUsageEvent), nextCursor };
}

// --- Ingestion stats --------------------------------------------------------

export async function getIngestionStats(f: RangeFilter): Promise<IngestionStats> {
  const cid = f.collectionId ?? null;
  const row = await firstRow(sql`
    SELECT
      COUNT(*)::int AS "documentsProcessed",
      AVG(latency_total_ms) FILTER (WHERE status = 'success')::float8 AS "avgDurationMs",
      AVG(chunk_count) FILTER (WHERE status = 'success')::float8 AS "avgChunksPerDoc",
      COUNT(*) FILTER (WHERE status = 'error')::int AS "failures",
      COALESCE(SUM(bytes_processed) FILTER (WHERE status = 'success'), 0)::float8 AS "totalBytesProcessed"
    FROM usage_events
    WHERE tenant_id = ${f.tenantId}
      AND event_type = 'ingestion'
      AND created_at >= ${f.from}
      AND created_at < ${f.to}
      AND (${cid}::text IS NULL OR collection_id = ${cid}::text)
  `);

  const documentsProcessed = num(row?.documentsProcessed);
  return {
    documentsProcessed,
    avgDurationMs: numOrNull(row?.avgDurationMs),
    avgChunksPerDoc: numOrNull(row?.avgChunksPerDoc),
    failureRate:
      documentsProcessed > 0 ? num(row?.failures) / documentsProcessed : 0,
    totalBytesProcessed: num(row?.totalBytesProcessed),
  };
}

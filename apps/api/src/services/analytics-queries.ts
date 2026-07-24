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
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { collections as collectionsTable } from "../db/schema";
import { percentileRankSql } from "../lib/percentile";

/**
 * SQL aggregation for the analytics API (Feature 5, Part B).
 *
 * Every figure the dashboard shows is computed by the DATABASE — these
 * functions issue GROUP BY / window-function queries and return already-
 * reduced rows. No endpoint ever pulls raw event rows into JS to reduce them
 * (the one exception, `recentEvents`, is an intentionally paginated row
 * listing, not an aggregation).
 *
 * Percentiles are computed in SQL via a `ROW_NUMBER()` CTE whose rank filter
 * comes from {@link percentileRankSql} — the single source of truth for the
 * percentile formula (see lib/percentile.ts + its tests).
 *
 * Tenant isolation: `tenant_id = ?` is the first predicate of every query;
 * these functions are only reachable behind session auth (see routes).
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

// --- Small D1 helpers -------------------------------------------------------

async function all<T>(
  db: D1Database,
  query: string,
  binds: unknown[],
): Promise<T[]> {
  const res = await db
    .prepare(query)
    .bind(...binds)
    .all<T>();
  return res.results ?? [];
}

async function first<T>(
  db: D1Database,
  query: string,
  binds: unknown[],
): Promise<T | null> {
  return (
    (await db
      .prepare(query)
      .bind(...binds)
      .first<T>()) ?? null
  );
}

/** Standard bind tuple for the range+collection predicate `?1..?4`. */
function rangeBinds(f: RangeFilter): unknown[] {
  return [f.tenantId, f.from, f.to, f.collectionId ?? null];
}

/** The reusable WHERE fragment (query events, tenant + range + collection). */
const QUERY_WHERE =
  "tenant_id = ?1 AND event_type = 'query' AND created_at >= ?2 AND created_at < ?3 AND (?4 IS NULL OR collection_id = ?4)";

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

async function windowAggregates(
  db: D1Database,
  f: RangeFilter,
): Promise<WindowAgg> {
  const row = await first<WindowAgg>(
    db,
    `SELECT
       COUNT(*) AS totalQueries,
       COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success,
       COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errorCount,
       COALESCE(SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END), 0) AS rateLimited,
       COALESCE(SUM(COALESCE(tokens_prompt, 0) + COALESCE(tokens_completion, 0)), 0) AS totalTokens,
       COALESCE(SUM(estimated_cost), 0) AS estimatedCost,
       COUNT(DISTINCT collection_id) AS activeCollections
     FROM usage_events
     WHERE ${QUERY_WHERE}`,
    rangeBinds(f),
  );
  return (
    row ?? {
      totalQueries: 0,
      success: 0,
      errorCount: 0,
      rateLimited: 0,
      totalTokens: 0,
      estimatedCost: 0,
      activeCollections: 0,
    }
  );
}

async function latencyPercentiles(
  db: D1Database,
  f: RangeFilter,
): Promise<{ p50: number; p95: number }> {
  const row = await first<{ p50: number; p95: number }>(
    db,
    `WITH q AS (
       SELECT latency_total_ms AS v FROM usage_events
       WHERE ${QUERY_WHERE} AND latency_total_ms IS NOT NULL
     ),
     ordered AS (
       SELECT v, ROW_NUMBER() OVER (ORDER BY v) AS rn, COUNT(*) OVER () AS cnt FROM q
     )
     SELECT
       COALESCE(MAX(CASE WHEN rn = ${percentileRankSql("cnt", 0.5)} THEN v END), 0) AS p50,
       COALESCE(MAX(CASE WHEN rn = ${percentileRankSql("cnt", 0.95)} THEN v END), 0) AS p95
     FROM ordered`,
    rangeBinds(f),
  );
  return row ?? { p50: 0, p95: 0 };
}

/** KPI summary for the range plus the immediately-preceding equal-length window. */
export async function getSummary(
  db: D1Database,
  f: RangeFilter,
): Promise<AnalyticsSummary> {
  const windowMs = f.to - f.from;
  const prev: RangeFilter = {
    ...f,
    from: f.from - windowMs,
    to: f.from,
  };

  const [cur, prevAgg, curP, prevP] = await Promise.all([
    windowAggregates(db, f),
    windowAggregates(db, prev),
    latencyPercentiles(db, f),
    latencyPercentiles(db, prev),
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

interface BucketCountRow {
  bucket: number;
  success: number;
  error: number;
  rateLimited: number;
  noResults: number;
  avgLatencyMs: number | null;
  tokens: number;
  estimatedCost: number;
}

export async function getTimeseries(
  db: D1Database,
  f: RangeFilter,
  override?: TimeseriesGranularity,
): Promise<TimeseriesResponse> {
  const granularity = pickGranularity(f.from, f.to, override);
  const bucketMs = granularity === "hour" ? HOUR_MS : DAY_MS;
  const binds = [...rangeBinds(f), bucketMs];

  // Counts by status + avg latency + tokens/cost, per bucket.
  const counts = await all<BucketCountRow>(
    db,
    `SELECT
       (created_at / ?5) * ?5 AS bucket,
       COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success,
       COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS error,
       COALESCE(SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END), 0) AS rateLimited,
       COALESCE(SUM(CASE WHEN status = 'no_results' THEN 1 ELSE 0 END), 0) AS noResults,
       AVG(latency_total_ms) AS avgLatencyMs,
       COALESCE(SUM(COALESCE(tokens_prompt, 0) + COALESCE(tokens_completion, 0)), 0) AS tokens,
       COALESCE(SUM(estimated_cost), 0) AS estimatedCost
     FROM usage_events
     WHERE ${QUERY_WHERE}
     GROUP BY bucket
     ORDER BY bucket`,
    binds,
  );

  // p95 latency per bucket (window function partitioned by bucket).
  const p95Rows = await all<{ bucket: number; p95: number }>(
    db,
    `WITH q AS (
       SELECT (created_at / ?5) * ?5 AS bucket, latency_total_ms AS v
       FROM usage_events
       WHERE ${QUERY_WHERE} AND latency_total_ms IS NOT NULL
     ),
     ordered AS (
       SELECT bucket, v,
              ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY v) AS rn,
              COUNT(*) OVER (PARTITION BY bucket) AS cnt
       FROM q
     )
     SELECT bucket, MAX(CASE WHEN rn = ${percentileRankSql("cnt", 0.95)} THEN v END) AS p95
     FROM ordered
     GROUP BY bucket`,
    binds,
  );
  const p95ByBucket = new Map(p95Rows.map((r) => [r.bucket, r.p95]));
  const countsByBucket = new Map(counts.map((r) => [r.bucket, r]));

  // Emit a CONTINUOUS series: fill empty buckets so the chart has no gaps.
  // Merging already-aggregated buckets is not "reducing raw rows".
  const points: TimeseriesPoint[] = [];
  const firstBucket = Math.floor(f.from / bucketMs) * bucketMs;
  const lastBucket = Math.floor((f.to - 1) / bucketMs) * bucketMs;
  for (let b = firstBucket; b <= lastBucket; b += bucketMs) {
    const row = countsByBucket.get(b);
    points.push({
      bucket: b,
      success: row?.success ?? 0,
      error: row?.error ?? 0,
      rateLimited: row?.rateLimited ?? 0,
      noResults: row?.noResults ?? 0,
      avgLatencyMs: row?.avgLatencyMs ?? null,
      p95LatencyMs: p95ByBucket.get(b) ?? null,
      tokens: row?.tokens ?? 0,
      estimatedCost: row?.estimatedCost ?? 0,
    });
  }

  return { granularity, points };
}

// --- Breakdown --------------------------------------------------------------

export async function getBreakdown(
  db: D1Database,
  drizzle: Db,
  f: RangeFilter,
): Promise<BreakdownResponse> {
  const binds = rangeBinds(f);

  const [byCollectionRaw, byStatus, byAuthType, stage] = await Promise.all([
    all<{ key: string; count: number }>(
      db,
      `SELECT collection_id AS key, COUNT(*) AS count
       FROM usage_events
       WHERE ${QUERY_WHERE} AND collection_id IS NOT NULL
       GROUP BY collection_id
       ORDER BY count DESC`,
      binds,
    ),
    all<{ key: string; count: number }>(
      db,
      `SELECT status AS key, COUNT(*) AS count
       FROM usage_events
       WHERE ${QUERY_WHERE}
       GROUP BY status
       ORDER BY count DESC`,
      binds,
    ),
    all<{ key: string; count: number }>(
      db,
      `SELECT auth_type AS key, COUNT(*) AS count
       FROM usage_events
       WHERE ${QUERY_WHERE}
       GROUP BY auth_type
       ORDER BY count DESC`,
      binds,
    ),
    first<{
      embed: number | null;
      retrieval: number | null;
      generation: number | null;
    }>(
      db,
      `SELECT AVG(latency_embed_ms) AS embed,
              AVG(latency_retrieval_ms) AS retrieval,
              AVG(latency_generation_ms) AS generation
       FROM usage_events
       WHERE ${QUERY_WHERE}`,
      binds,
    ),
  ]);

  // Resolve collection names for the grouping labels (tenant-scoped).
  const ids = byCollectionRaw.map((r) => r.key);
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const rows = await drizzle
      .select({ id: collectionsTable.id, name: collectionsTable.name })
      .from(collectionsTable)
      .where(
        and(
          eq(collectionsTable.tenantId, f.tenantId),
          inArray(collectionsTable.id, ids),
        ),
      );
    for (const r of rows) nameById.set(r.id, r.name);
  }

  const byCollection: BreakdownCount[] = byCollectionRaw.map((r) => ({
    key: r.key,
    label: nameById.get(r.key) ?? "(deleted collection)",
    count: r.count,
  }));

  const labeled = (rows: { key: string; count: number }[]): BreakdownCount[] =>
    rows.map((r) => ({ key: r.key, label: r.key, count: r.count }));

  const stageLatency: StageLatency = {
    embed: stage?.embed ?? null,
    retrieval: stage?.retrieval ?? null,
    generation: stage?.generation ?? null,
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

interface UsageEventDbRow {
  id: string;
  tenant_id: string;
  event_type: string;
  created_at: number;
  collection_id: string | null;
  document_id: string | null;
  auth_type: string;
  api_key_id: string | null;
  status: string;
  error_code: string | null;
  latency_total_ms: number | null;
  latency_embed_ms: number | null;
  latency_retrieval_ms: number | null;
  latency_generation_ms: number | null;
  chunks_retrieved: number | null;
  top_score: number | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  estimated_cost: number | null;
  query_length: number | null;
  query_text: string | null;
  bytes_processed: number | null;
  chunk_count: number | null;
}

function toUsageEvent(r: UsageEventDbRow): UsageEvent {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    eventType: r.event_type as UsageEvent["eventType"],
    createdAt: r.created_at,
    collectionId: r.collection_id,
    documentId: r.document_id,
    authType: r.auth_type as UsageEvent["authType"],
    apiKeyId: r.api_key_id,
    status: r.status as UsageEventStatus,
    errorCode: r.error_code,
    latencyTotalMs: r.latency_total_ms,
    latencyEmbedMs: r.latency_embed_ms,
    latencyRetrievalMs: r.latency_retrieval_ms,
    latencyGenerationMs: r.latency_generation_ms,
    chunksRetrieved: r.chunks_retrieved,
    topScore: r.top_score,
    tokensPrompt: r.tokens_prompt,
    tokensCompletion: r.tokens_completion,
    estimatedCost: r.estimated_cost,
    queryLength: r.query_length,
    bytesProcessed: r.bytes_processed,
    chunkCount: r.chunk_count,
    queryText: r.query_text,
  };
}

export async function getRecentEvents(
  db: D1Database,
  f: RecentFilter,
): Promise<{ events: UsageEvent[]; nextCursor: string | null }> {
  // Keyset pagination on (created_at, id) DESC — stable and index-friendly.
  const binds: unknown[] = [f.tenantId, f.from, f.to, f.collectionId ?? null];
  let where =
    "tenant_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND (?4 IS NULL OR collection_id = ?4)";

  // Positional params continue from ?5.
  let n = 5;
  if (f.status) {
    where += ` AND status = ?${n}`;
    binds.push(f.status);
    n++;
  }
  if (f.cursor) {
    const [cAt, cId] = f.cursor.split("_");
    // Rows strictly "older" than the cursor in (created_at, id) DESC order.
    where += ` AND (created_at < ?${n} OR (created_at = ?${n} AND id < ?${n + 1}))`;
    binds.push(Number(cAt), cId);
    n += 2;
  }
  const limitParam = n;
  binds.push(f.limit + 1); // fetch one extra to detect a next page

  const rows = await all<UsageEventDbRow>(
    db,
    `SELECT * FROM usage_events
     WHERE ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT ?${limitParam}`,
    binds,
  );

  const hasMore = rows.length > f.limit;
  const page = hasMore ? rows.slice(0, f.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? `${last.created_at}_${last.id}` : null;

  return { events: page.map(toUsageEvent), nextCursor };
}

// --- Ingestion stats --------------------------------------------------------

export async function getIngestionStats(
  db: D1Database,
  f: RangeFilter,
): Promise<IngestionStats> {
  const row = await first<{
    documentsProcessed: number;
    avgDurationMs: number | null;
    avgChunksPerDoc: number | null;
    failures: number;
    totalBytesProcessed: number;
  }>(
    db,
    `SELECT
       COUNT(*) AS documentsProcessed,
       AVG(CASE WHEN status = 'success' THEN latency_total_ms END) AS avgDurationMs,
       AVG(CASE WHEN status = 'success' THEN chunk_count END) AS avgChunksPerDoc,
       COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS failures,
       COALESCE(SUM(CASE WHEN status = 'success' THEN bytes_processed ELSE 0 END), 0) AS totalBytesProcessed
     FROM usage_events
     WHERE tenant_id = ?1 AND event_type = 'ingestion'
       AND created_at >= ?2 AND created_at < ?3
       AND (?4 IS NULL OR collection_id = ?4)`,
    rangeBinds(f),
  );

  const documentsProcessed = row?.documentsProcessed ?? 0;
  return {
    documentsProcessed,
    avgDurationMs: row?.avgDurationMs ?? null,
    avgChunksPerDoc: row?.avgChunksPerDoc ?? null,
    failureRate:
      documentsProcessed > 0 ? (row?.failures ?? 0) / documentsProcessed : 0,
    totalBytesProcessed: row?.totalBytesProcessed ?? 0,
  };
}

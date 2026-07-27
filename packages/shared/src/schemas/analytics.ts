/** Usage analytics Zod schemas — source of truth for the API and web app. */
import { z } from "zod";
import {
  AuthTypeSchema,
  UsageEventStatusSchema,
  UsageEventTypeSchema,
  TimeseriesGranularitySchema,
  epochMillis,
} from "./common";

/**
 * One recorded usage event. Mirrors the D1 `usage_events` row. Privacy: raw
 * query text is NEVER included unless STORE_RAW_QUERY_TEXT is on — only a hash
 * and length. Nullable columns surface as `null` (D1-native) rather than absent.
 */
export const UsageEventSchema = z
  .object({
    id: z.string().meta({ example: "evt_7d3f2a10" }),
    tenantId: z.string().meta({ example: "org_2abc123" }),
    eventType: UsageEventTypeSchema,
    createdAt: epochMillis(),
    collectionId: z.string().nullable().meta({ example: "col_9f8b2a1c" }),
    documentId: z.string().nullable().meta({ example: null }),
    authType: AuthTypeSchema,
    apiKeyId: z.string().nullable().meta({ example: "key_1a2b3c4d" }),
    status: UsageEventStatusSchema,
    errorCode: z.string().nullable().meta({ example: null }),
    latencyTotalMs: z.number().nullable().meta({ example: 842 }),
    latencyEmbedMs: z.number().nullable().meta({ example: 31 }),
    latencyRetrievalMs: z.number().nullable().meta({ example: 58 }),
    latencyGenerationMs: z.number().nullable().meta({ example: 740 }),
    chunksRetrieved: z.number().nullable().meta({ example: 8 }),
    topScore: z.number().nullable().meta({ example: 0.82 }),
    tokensPrompt: z.number().nullable().meta({ example: 1240 }),
    tokensCompletion: z.number().nullable().meta({ example: 96 }),
    estimatedCost: z.number().nullable().meta({ example: 0.00058 }),
    queryLength: z.number().nullable().meta({ example: 41 }),
    bytesProcessed: z.number().nullable().meta({ example: null }),
    chunkCount: z.number().nullable().meta({ example: null }),
    queryText: z
      .string()
      .nullable()
      .optional()
      .meta({ description: "Present only when STORE_RAW_QUERY_TEXT is on." }),
  })
  .meta({ id: "UsageEvent" });

/** Shared range + filter query parameters accepted by every analytics endpoint. */
export const AnalyticsRangeParamsSchema = z
  .object({
    from: epochMillis(1_753_200_000_000),
    to: epochMillis(1_753_800_000_000),
    collectionId: z.string().optional().meta({ example: "col_9f8b2a1c" }),
  })
  .meta({ id: "AnalyticsRangeParams" });

/** A single KPI value paired with its value in the previous equivalent period. */
export const MetricWithDeltaSchema = z
  .object({
    value: z.number().meta({ example: 1284 }),
    previous: z.number().meta({ example: 1102 }),
  })
  .meta({ id: "MetricWithDelta" });

/** Response for GET /v1/analytics/summary — KPI totals + previous period. */
export const AnalyticsSummarySchema = z
  .object({
    range: z.object({ from: epochMillis(1_753_200_000_000), to: epochMillis(1_753_800_000_000) }),
    totalQueries: MetricWithDeltaSchema,
    successRate: MetricWithDeltaSchema,
    p50LatencyMs: MetricWithDeltaSchema,
    p95LatencyMs: MetricWithDeltaSchema,
    totalTokens: MetricWithDeltaSchema,
    estimatedCost: MetricWithDeltaSchema,
    activeCollections: MetricWithDeltaSchema,
    errorCount: MetricWithDeltaSchema,
    rateLimitedCount: MetricWithDeltaSchema,
  })
  .meta({ id: "AnalyticsSummary" });

/** One bucket of the time series. Counts are split by outcome. */
export const TimeseriesPointSchema = z
  .object({
    bucket: epochMillis(),
    success: z.number().int().meta({ example: 120 }),
    error: z.number().int().meta({ example: 3 }),
    rateLimited: z.number().int().meta({ example: 1 }),
    noResults: z.number().int().meta({ example: 5 }),
    avgLatencyMs: z.number().nullable().meta({ example: 812 }),
    p95LatencyMs: z.number().nullable().meta({ example: 1503 }),
    tokens: z.number().int().meta({ example: 154_200 }),
    estimatedCost: z.number().meta({ example: 0.42 }),
  })
  .meta({ id: "TimeseriesPoint" });

/** Response for GET /v1/analytics/timeseries. */
export const TimeseriesResponseSchema = z
  .object({
    granularity: TimeseriesGranularitySchema,
    points: z.array(TimeseriesPointSchema),
  })
  .meta({ id: "TimeseriesResponse" });

/** A labeled count, used across the breakdown groupings. */
export const BreakdownCountSchema = z
  .object({
    key: z.string().meta({ example: "col_9f8b2a1c" }),
    label: z.string().meta({ example: "Product docs" }),
    count: z.number().int().meta({ example: 842 }),
  })
  .meta({ id: "BreakdownCount" });

/** Average latency split by pipeline stage (ms) across the window. */
export const StageLatencySchema = z
  .object({
    embed: z.number().nullable().meta({ example: 30 }),
    retrieval: z.number().nullable().meta({ example: 55 }),
    generation: z.number().nullable().meta({ example: 720 }),
  })
  .meta({ id: "StageLatency" });

/** Response for GET /v1/analytics/breakdown. */
export const BreakdownResponseSchema = z
  .object({
    byCollection: z.array(BreakdownCountSchema),
    byStatus: z.array(BreakdownCountSchema),
    byAuthType: z.array(BreakdownCountSchema),
    stageLatency: StageLatencySchema,
  })
  .meta({ id: "BreakdownResponse" });

/** Response for GET /v1/analytics/ingestion. */
export const IngestionStatsSchema = z
  .object({
    documentsProcessed: z.number().int().meta({ example: 37 }),
    avgDurationMs: z.number().nullable().meta({ example: 4210 }),
    avgChunksPerDoc: z.number().nullable().meta({ example: 58 }),
    failureRate: z.number().meta({ example: 0.05 }),
    totalBytesProcessed: z.number().int().meta({ example: 9_128_442 }),
  })
  .meta({ id: "IngestionStats" });

/** Response for GET /v1/analytics/recent — paginated drill-down rows. */
export const RecentEventsResponseSchema = z
  .object({
    events: z.array(UsageEventSchema),
    nextCursor: z.string().nullable().meta({ example: "1753800000000_evt_7d3f2a10" }),
  })
  .meta({ id: "RecentEventsResponse" });

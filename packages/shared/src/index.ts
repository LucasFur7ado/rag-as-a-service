/**
 * @rag/shared — shared domain schemas + types for the RAG-as-a-Service platform.
 *
 * Zod is the single source of truth. Every request/response shape is defined
 * once as a Zod schema in `./schemas/*`; the TypeScript types below are inferred
 * from those schemas, and the OpenAPI 3.1 spec (apps/api) is generated from the
 * same schemas — so the docs, the runtime validation, and the compile-time
 * types can never drift apart.
 *
 * Imported by both halves of the app: the browser client and the API route
 * Worker). The only runtime dependency is `zod`.
 */
import type { z } from "zod";

// Re-export every schema so apps/api can build routes/the spec from them.
export * from "./schemas/common";
export * from "./schemas/collections";
export * from "./schemas/documents";
export * from "./schemas/query";
export * from "./schemas/apikeys";
export * from "./schemas/analytics";

import type {
  DocumentStatusSchema,
  AuthTypeSchema,
  AuthContextSchema,
  UsageEventTypeSchema,
  UsageEventStatusSchema,
  TimeseriesGranularitySchema,
} from "./schemas/common";
import type {
  CollectionSchema,
  CreateCollectionRequestSchema,
  ListCollectionsResponseSchema,
} from "./schemas/collections";
import type {
  DocumentSchema,
  ListDocumentsResponseSchema,
  UploadDocumentResponseSchema,
  DocumentStatusResponseSchema,
  ReingestDocumentResponseSchema,
} from "./schemas/documents";
import type {
  QueryRequestSchema,
  CitationSchema,
  QueryUsageSchema,
  QueryResponseSchema,
  QueryDeltaEventSchema,
  QuerySourcesEventSchema,
  QueryDoneEventSchema,
  QueryErrorEventSchema,
  QueryStreamEventSchema,
  RateLimitErrorBodySchema,
} from "./schemas/query";
import type {
  ApiKeySchema,
  CreateApiKeyRequestSchema,
  ApiKeyCreateResponseSchema,
  ListApiKeysResponseSchema,
} from "./schemas/apikeys";
import type {
  UsageEventSchema,
  AnalyticsRangeParamsSchema,
  MetricWithDeltaSchema,
  AnalyticsSummarySchema,
  TimeseriesPointSchema,
  TimeseriesResponseSchema,
  BreakdownCountSchema,
  StageLatencySchema,
  BreakdownResponseSchema,
  IngestionStatsSchema,
  RecentEventsResponseSchema,
} from "./schemas/analytics";

// --- Primitive aliases (kept as plain types; not request/response shapes) ---

/** ISO-8601 timestamp string, e.g. "2026-07-21T12:34:56.000Z". */
export type IsoDateString = string;
/** Epoch milliseconds — how the API stores and returns timestamps (bigint). */
export type EpochMillis = number;

/**
 * A tenant is the top-level isolation boundary. Every Collection, Document and
 * query is scoped to exactly one tenant. In the current model a tenant maps to
 * a Clerk organization (or a single user acting as their own tenant).
 */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: IsoDateString;
}

// --- Inferred types (Zod is the source of truth; names unchanged) -----------

export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;
export type AuthType = z.infer<typeof AuthTypeSchema>;
export type AuthContext = z.infer<typeof AuthContextSchema>;
export type UsageEventType = z.infer<typeof UsageEventTypeSchema>;
export type UsageEventStatus = z.infer<typeof UsageEventStatusSchema>;
export type TimeseriesGranularity = z.infer<typeof TimeseriesGranularitySchema>;

export type Collection = z.infer<typeof CollectionSchema>;
export type CreateCollectionRequest = z.infer<typeof CreateCollectionRequestSchema>;
export type ListCollectionsResponse = z.infer<typeof ListCollectionsResponseSchema>;

export type Document = z.infer<typeof DocumentSchema>;
export type ListDocumentsResponse = z.infer<typeof ListDocumentsResponseSchema>;
export type UploadDocumentResponse = z.infer<typeof UploadDocumentResponseSchema>;
export type DocumentStatusResponse = z.infer<typeof DocumentStatusResponseSchema>;
export type ReingestDocumentResponse = z.infer<typeof ReingestDocumentResponseSchema>;

export type QueryRequest = z.infer<typeof QueryRequestSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type QueryUsage = z.infer<typeof QueryUsageSchema>;
export type QueryResponse = z.infer<typeof QueryResponseSchema>;
export type QueryDeltaEvent = z.infer<typeof QueryDeltaEventSchema>;
export type QuerySourcesEvent = z.infer<typeof QuerySourcesEventSchema>;
export type QueryDoneEvent = z.infer<typeof QueryDoneEventSchema>;
export type QueryErrorEvent = z.infer<typeof QueryErrorEventSchema>;
export type QueryStreamEvent = z.infer<typeof QueryStreamEventSchema>;
export type RateLimitErrorBody = z.infer<typeof RateLimitErrorBodySchema>;

export type ApiKey = z.infer<typeof ApiKeySchema>;
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;
export type ApiKeyCreateResponse = z.infer<typeof ApiKeyCreateResponseSchema>;
export type ListApiKeysResponse = z.infer<typeof ListApiKeysResponseSchema>;

export type UsageEvent = z.infer<typeof UsageEventSchema>;
export type AnalyticsRangeParams = z.infer<typeof AnalyticsRangeParamsSchema>;
export type MetricWithDelta = z.infer<typeof MetricWithDeltaSchema>;
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;
export type TimeseriesPoint = z.infer<typeof TimeseriesPointSchema>;
export type TimeseriesResponse = z.infer<typeof TimeseriesResponseSchema>;
export type BreakdownCount = z.infer<typeof BreakdownCountSchema>;
export type StageLatency = z.infer<typeof StageLatencySchema>;
export type BreakdownResponse = z.infer<typeof BreakdownResponseSchema>;
export type IngestionStats = z.infer<typeof IngestionStatsSchema>;
export type RecentEventsResponse = z.infer<typeof RecentEventsResponseSchema>;

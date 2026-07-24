import type { AuthType, UsageEventStatus, UsageEventType } from "@rag/shared";
import type { Env } from "../env";
import { getDb } from "../db";
import { usageEvents, type NewUsageEventRow } from "../db/schema";
import { STORE_RAW_QUERY_TEXT } from "../config";
import { sha256Hex } from "./apikeys";

/**
 * Usage analytics recording (Feature 5).
 *
 * Every write here happens OFF the request critical path — callers wrap
 * `record()` in `c.executionCtx.waitUntil(...)` and NEVER await it before
 * responding. On top of that, `record()` swallows its own failures (logs
 * only): a broken analytics backend must never fail or slow a user request.
 *
 * The backend is swappable behind the {@link AnalyticsRecorder} interface:
 * - {@link D1AnalyticsRecorder} — the primary store. SQL aggregation over the
 *   `usage_events` table backs the dashboard, and volume here is
 *   portfolio-scale, so D1 is the pragmatic choice.
 * - {@link AnalyticsEngineRecorder} — dual-write to Workers Analytics Engine.
 *   This is the CORRECT answer at high write volume: Analytics Engine is
 *   built for unbounded, high-cardinality time-series writes (`writeDataPoint`
 *   is fire-and-forget and effectively free), whereas D1 would become a write
 *   bottleneck. It is wired behind {@link resolveRecorder} and enabled only
 *   when the `USAGE_ANALYTICS` binding exists. NOTE: Analytics Engine is
 *   write-only from a Worker — reading it back requires the account-level SQL
 *   API (an API token), so the dashboard still reads D1. That's why the dual
 *   write is additive, not a replacement, at this scale.
 */

/** Fields a caller supplies for one event; id/createdAt/hash are derived. */
export interface RecordEventInput {
  tenantId: string;
  eventType: UsageEventType;
  /** Defaults to Date.now() when omitted. */
  createdAt?: number;
  collectionId?: string | null;
  documentId?: string | null;
  authType: AuthType;
  apiKeyId?: string | null;
  status: UsageEventStatus;
  errorCode?: string | null;
  latencyTotalMs?: number | null;
  latencyEmbedMs?: number | null;
  latencyRetrievalMs?: number | null;
  latencyGenerationMs?: number | null;
  chunksRetrieved?: number | null;
  topScore?: number | null;
  tokensPrompt?: number | null;
  tokensCompletion?: number | null;
  estimatedCost?: number | null;
  /**
   * Raw query text. Hashed into `query_hash` and its length recorded; the
   * plaintext itself is persisted ONLY when STORE_RAW_QUERY_TEXT is enabled.
   */
  queryText?: string | null;
  /** Query length; derived from `queryText` when omitted. */
  queryLength?: number | null;
  bytesProcessed?: number | null;
  chunkCount?: number | null;
}

/**
 * The single seam every instrumentation point depends on. `record()` resolves
 * once the event is durably written (or once it has failed and been
 * swallowed) — it never rejects.
 */
export interface AnalyticsRecorder {
  record(event: RecordEventInput): Promise<void>;
}

/**
 * Primary recorder: one INSERT into D1 `usage_events`. Query privacy is
 * enforced here — the raw text is hashed and only stored when the flag is on.
 */
export class D1AnalyticsRecorder implements AnalyticsRecorder {
  constructor(private readonly env: Env) {}

  async record(event: RecordEventInput): Promise<void> {
    try {
      const row = await toRow(event);
      await getDb(this.env).insert(usageEvents).values(row);
    } catch (err) {
      // Advisory write — never surface to the request that already succeeded.
      console.error("Failed to record usage event (D1):", err);
    }
  }
}

/**
 * Dual-write recorder for Workers Analytics Engine. Dimensions go in `blobs`
 * (filterable), metrics in `doubles`, and the tenant id is the sampling
 * `index`. `writeDataPoint` is synchronous fire-and-forget; there is nothing
 * to await.
 */
export class AnalyticsEngineRecorder implements AnalyticsRecorder {
  constructor(private readonly dataset: AnalyticsEngineDataset) {}

  async record(event: RecordEventInput): Promise<void> {
    try {
      this.dataset.writeDataPoint({
        // Single index only (Analytics Engine constraint) — tenant is the
        // natural sampling/grouping key.
        indexes: [event.tenantId],
        // Order is the schema; keep it stable. Empty strings for absent dims.
        blobs: [
          event.eventType,
          event.status,
          event.authType,
          event.collectionId ?? "",
          event.errorCode ?? "",
          event.documentId ?? "",
          event.apiKeyId ?? "",
        ],
        doubles: [
          event.latencyTotalMs ?? 0,
          event.latencyEmbedMs ?? 0,
          event.latencyRetrievalMs ?? 0,
          event.latencyGenerationMs ?? 0,
          event.chunksRetrieved ?? 0,
          event.topScore ?? 0,
          (event.tokensPrompt ?? 0) + (event.tokensCompletion ?? 0),
          event.estimatedCost ?? 0,
          event.bytesProcessed ?? 0,
          event.chunkCount ?? 0,
        ],
      });
    } catch (err) {
      console.error("Failed to record usage event (Analytics Engine):", err);
    }
  }
}

/** Fans one event out to several recorders; each isolates its own failures. */
export class CompositeAnalyticsRecorder implements AnalyticsRecorder {
  constructor(private readonly recorders: AnalyticsRecorder[]) {}

  async record(event: RecordEventInput): Promise<void> {
    await Promise.allSettled(this.recorders.map((r) => r.record(event)));
  }
}

/** No-op recorder (e.g. if analytics is disabled). Records nothing. */
export class NoopAnalyticsRecorder implements AnalyticsRecorder {
  async record(): Promise<void> {
    // Intentionally empty.
  }
}

/**
 * Build the recorder for this environment: D1 always, plus Analytics Engine
 * when its binding is present (the dual-write path described above).
 */
export function resolveRecorder(env: Env): AnalyticsRecorder {
  const recorders: AnalyticsRecorder[] = [new D1AnalyticsRecorder(env)];
  if (env.USAGE_ANALYTICS) {
    recorders.push(new AnalyticsEngineRecorder(env.USAGE_ANALYTICS));
  }
  return recorders.length === 1
    ? recorders[0]
    : new CompositeAnalyticsRecorder(recorders);
}

/**
 * Convenience wrapper for instrumentation points: record an event entirely
 * off the critical path. Errors are swallowed inside `record()`, but we
 * defensively guard the enqueue too so a malformed input can never bubble
 * into the request. Callers pass `c.executionCtx.waitUntil(...)` as `waitUntil`.
 */
export function recordEvent(
  env: Env,
  waitUntil: (p: Promise<unknown>) => void,
  event: RecordEventInput,
): void {
  try {
    waitUntil(resolveRecorder(env).record(event));
  } catch (err) {
    console.error("Failed to enqueue usage event:", err);
  }
}

/** Map a caller's input to a fully-populated D1 row (hashing/privacy applied). */
async function toRow(event: RecordEventInput): Promise<NewUsageEventRow> {
  const queryText = event.queryText ?? null;
  const queryHash = queryText ? await sha256Hex(queryText) : null;
  return {
    id: crypto.randomUUID(),
    tenantId: event.tenantId,
    eventType: event.eventType,
    createdAt: event.createdAt ?? Date.now(),
    collectionId: event.collectionId ?? null,
    documentId: event.documentId ?? null,
    authType: event.authType,
    apiKeyId: event.apiKeyId ?? null,
    status: event.status,
    errorCode: event.errorCode ?? null,
    latencyTotalMs: event.latencyTotalMs ?? null,
    latencyEmbedMs: event.latencyEmbedMs ?? null,
    latencyRetrievalMs: event.latencyRetrievalMs ?? null,
    latencyGenerationMs: event.latencyGenerationMs ?? null,
    chunksRetrieved: event.chunksRetrieved ?? null,
    topScore: event.topScore ?? null,
    tokensPrompt: event.tokensPrompt ?? null,
    tokensCompletion: event.tokensCompletion ?? null,
    estimatedCost: event.estimatedCost ?? null,
    queryHash,
    queryLength: event.queryLength ?? (queryText ? queryText.length : null),
    // Privacy gate: raw text only when explicitly enabled.
    queryText: STORE_RAW_QUERY_TEXT ? queryText : null,
    bytesProcessed: event.bytesProcessed ?? null,
    chunkCount: event.chunkCount ?? null,
  };
}

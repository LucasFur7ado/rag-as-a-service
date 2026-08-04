import "server-only";

import type { AuthType, UsageEventStatus, UsageEventType } from "@rag/shared";
import { getDb } from "../db";
import { usageEvents, type NewUsageEventRow } from "../db/schema";
import { STORE_RAW_QUERY_TEXT } from "../config";
import { sha256Hex } from "./apikeys";

/**
 * Usage analytics recording.
 *
 * Every write here happens OFF the request critical path — callers wrap
 * `record()` in `after(...)` from `next/server` and NEVER await it before
 * responding. On top of that, `record()` swallows its own failures (logs
 * only): a broken analytics backend must never fail or slow a user request.
 *
 * The backend is swappable behind the {@link AnalyticsRecorder} interface.
 * Postgres is the primary (and, at this scale, only) store: SQL aggregation
 * over `usage_events` backs the dashboard, and — unlike the write-only
 * Cloudflare Analytics Engine dual-write this replaces — it can be read back
 * from the same runtime that writes it. If write volume ever outgrows a single
 * Postgres writer, a column-store recorder (ClickHouse, Tinybird) slots in
 * behind {@link CompositeAnalyticsRecorder} without touching a call site.
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
 * Primary recorder: one INSERT into `usage_events`. Query privacy is enforced
 * here — the raw text is hashed and only stored when the flag is on.
 */
export class PostgresAnalyticsRecorder implements AnalyticsRecorder {
  async record(event: RecordEventInput): Promise<void> {
    try {
      const row = await toRow(event);
      await getDb().insert(usageEvents).values(row);
    } catch (err) {
      // Advisory write — never surface to the request that already succeeded.
      console.error("Failed to record usage event:", err);
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

/** Build the recorder for this environment. */
export function resolveRecorder(): AnalyticsRecorder {
  return new PostgresAnalyticsRecorder();
}

/**
 * Convenience wrapper for instrumentation points: record an event entirely
 * off the critical path. Errors are swallowed inside `record()`, but we
 * defensively guard the scheduling too so a malformed input can never bubble
 * into the request. Callers pass `after` from `next/server` as `defer`.
 */
export function recordEvent(
  defer: (task: () => Promise<unknown>) => void,
  event: RecordEventInput,
): void {
  try {
    defer(() => resolveRecorder().record(event));
  } catch (err) {
    console.error("Failed to schedule usage event:", err);
  }
}

/** Map a caller's input to a fully-populated row (hashing/privacy applied). */
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

import "server-only";

import { and, eq } from "drizzle-orm";
import type { AuthType } from "@rag/shared";
import { getDb } from "../db";
import { documents as documentsTable } from "../db/schema";
import { extractPages, type PageText } from "../lib/extract";
import { chunkPages, type Chunk } from "../lib/chunking";
import { PermanentError } from "../lib/errors";
import { getDocumentBytes } from "../lib/blob";
import { GeminiEmbeddingProvider } from "./embeddings";
import { PineconeVectorStore, vectorId, vectorNamespace } from "./vectorstore";
import {
  EMBED_BATCH_DELAY_MS,
  INGEST_RETRY_BASE_MS,
  INGEST_STEP_RETRIES,
  MAX_EMBED_BATCH_SIZE,
  VECTOR_TEXT_METADATA_MAX_CHARS,
} from "../config";
import { resolveRecorder } from "./analytics";

/**
 * Ingestion pipeline: parse → chunk → embed → upsert → finalize.
 *
 * **What replaced the Workflow.** On Cloudflare this ran as a durable
 * Workflow: each phase was a `step.do(...)` whose result was checkpointed, so
 * an instance could be evicted mid-run and resume from the last completed
 * step. Vercel has no equivalent durable-execution primitive, so the pipeline
 * is now a plain sequential function invoked through `after()` — it starts as
 * soon as the upload response is sent and runs inside that same invocation,
 * bounded by the route's `maxDuration`.
 *
 * What is preserved:
 * - **Retries with backoff** ({@link withRetries}) around every phase, so a
 *   transient provider failure (network, 429, 5xx) does not fail the document.
 * - **Fail-fast on deterministic errors**: a {@link PermanentError}
 *   (unparseable file, provider 4xx, config mismatch) skips retries entirely.
 * - **Terminal state always written**: every failure path ends by marking the
 *   document `error` with a readable message, so a document never hangs in
 *   `processing`.
 * - **Idempotency**: vector ids stay deterministic
 *   (`{documentId}#{chunkIndex}`), so a re-run overwrites vectors rather than
 *   duplicating them — which is what makes "Reprocess" safe and what lets a
 *   run that died mid-way simply be run again.
 *
 * What is lost, deliberately: cross-invocation resumption. A run killed by the
 * function timeout leaves the document in `processing`; `reingest` is the
 * recovery path, and {@link isStaleProcessing} lets the API offer it rather
 * than refusing with a 409 forever.
 *
 * Because there is no longer any cross-step state to persist, the R2 staging
 * artifacts (`.ingest/extracted.json`, `chunks.json`) the Workflow needed to
 * stay under its per-step payload limit are gone: pages and chunks are just
 * local variables now.
 */

export interface IngestParams {
  tenantId: string;
  collectionId: string;
  documentId: string;
  /** How the triggering request authenticated — carried through for analytics. */
  authType: AuthType;
  /** API key id when `authType === 'apikey'`; null otherwise. */
  apiKeyId: string | null;
}

/**
 * A document left in `processing` for longer than this is presumed abandoned
 * (its function invocation timed out or crashed), and `reingest` accepts it
 * instead of returning 409. Comfortably above the longest permitted run.
 */
export const STALE_PROCESSING_MS = 15 * 60_000;

/** Whether a `processing` document may be re-ingested (see above). */
export function isStaleProcessing(updatedAt: number): boolean {
  return Date.now() - updatedAt > STALE_PROCESSING_MS;
}

/**
 * Retry a phase with exponential backoff, but only for transient failures.
 * A `PermanentError` propagates on the first attempt — retrying an
 * unparseable PDF or a rejected API key just wastes the invocation's clock.
 */
async function withRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= INGEST_STEP_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PermanentError) throw err;
      lastError = err;
      if (attempt === INGEST_STEP_RETRIES) break;
      const delay = INGEST_RETRY_BASE_MS * 2 ** attempt;
      console.warn(
        `[ingest] ${label} failed (attempt ${attempt + 1}/${INGEST_STEP_RETRIES + 1}), retrying in ${delay}ms:`,
        err instanceof Error ? err.message : err,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/**
 * Run the pipeline for one document. Never throws: the caller schedules this
 * with `after()` and has already responded, so the only meaningful outcome is
 * the document's terminal status in the database.
 */
export async function runIngestion(params: IngestParams): Promise<void> {
  const { tenantId, collectionId, documentId } = params;
  const runId = crypto.randomUUID();
  const db = getDb();
  const startedAt = Date.now();
  let sizeBytes: number | null = null;
  let chunkCount = 0;

  try {
    // -- 1. Claim the document: 'processing' + record this run ---------------
    const doc = await withRetries("mark processing", async () => {
      const [row] = await db
        .select()
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.id, documentId),
            eq(documentsTable.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (!row) throw new PermanentError("Document no longer exists");
      await db
        .update(documentsTable)
        .set({
          status: "processing",
          error: null,
          ingestionRunId: runId,
          updatedAt: Date.now(),
        })
        .where(eq(documentsTable.id, documentId));
      return row;
    });
    sizeBytes = doc.sizeBytes;

    // -- 2. Fetch the raw file and extract plain text (with page numbers) ----
    const pages = await withRetries("extract text", async () => {
      const bytes = await getDocumentBytes(doc.blobPath);
      if (!bytes) {
        throw new PermanentError("Source file is missing from storage");
      }
      const extracted: PageText[] = await extractPages(bytes, doc.contentType);
      if (!extracted.some((p) => p.text.trim())) {
        throw new PermanentError(
          "No extractable text found — the file is empty or contains no text layer (e.g. a scanned PDF)",
        );
      }
      return extracted;
    });

    // -- 3. Chunk (recursive character splitting with overlap) --------------
    const chunks: Chunk[] = chunkPages(pages);
    if (chunks.length === 0) {
      throw new PermanentError("Chunking produced no usable text");
    }
    chunkCount = chunks.length;

    // -- 4. Preflight: embedding dimension must match the Pinecone index ----
    const embedder = new GeminiEmbeddingProvider();
    const store = new PineconeVectorStore();
    await withRetries("verify index dimension", async () => {
      const indexDim = await store.indexDimension();
      if (indexDim !== null && indexDim !== embedder.dimension) {
        throw new PermanentError(
          `Pinecone index dimension (${indexDim}) does not match the embedding model dimension (${embedder.dimension}). ` +
            `Recreate the index with dimension ${embedder.dimension} (metric: cosine).`,
        );
      }
    });

    // -- 5. Embed + upsert, in batches of <= MAX_EMBED_BATCH_SIZE -----------
    // Each batch retries independently, so a transient provider failure only
    // replays its own batch and completed batches are never re-embedded.
    const namespace = vectorNamespace(tenantId, collectionId);
    const batchCount = Math.ceil(chunks.length / MAX_EMBED_BATCH_SIZE);
    for (let batch = 0; batch < batchCount; batch++) {
      const slice = chunks.slice(
        batch * MAX_EMBED_BATCH_SIZE,
        (batch + 1) * MAX_EMBED_BATCH_SIZE,
      );
      await withRetries(`embed+upsert batch ${batch + 1}/${batchCount}`, async () => {
        const { vectors } = await embedder.embed(
          slice.map((c) => c.text),
          "document",
        );
        await store.upsert(
          namespace,
          slice.map((chunk, i) => ({
            id: vectorId(documentId, chunk.index),
            values: vectors[i],
            metadata: {
              tenantId,
              collectionId,
              documentId,
              chunkIndex: chunk.index,
              filename: doc.filename,
              ...(chunk.page !== null ? { page: chunk.page } : {}),
              text: chunk.text.slice(0, VECTOR_TEXT_METADATA_MAX_CHARS),
            },
          })),
        );
      });
      // Space the batches out to stay inside the Gemini free-tier RPM cap.
      if (batch < batchCount - 1) await sleep(EMBED_BATCH_DELAY_MS);
    }

    // -- 6. Finalize: mark 'ready' ------------------------------------------
    // Scoped by tenant AND by this run's id: if the document was deleted (or a
    // newer ingestion run claimed it) while we were embedding, this update
    // matches nothing and the run ends as a silent no-op instead of resurrecting
    // a deleted row or clobbering a fresher result.
    await withRetries("finalize", async () => {
      await db
        .update(documentsTable)
        .set({
          status: "ready",
          error: null,
          chunkCount: chunks.length,
          ingestedAt: Date.now(),
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(documentsTable.id, documentId),
            eq(documentsTable.tenantId, tenantId),
            eq(documentsTable.ingestionRunId, runId),
          ),
        );
    });

    // -- 7. Record the successful ingestion for analytics -------------------
    await resolveRecorder().record({
      tenantId,
      eventType: "ingestion",
      collectionId,
      documentId,
      authType: params.authType,
      apiKeyId: params.apiKeyId,
      status: "success",
      chunkCount: chunks.length,
      bytesProcessed: sizeBytes,
      latencyTotalMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Ingestion failed with an unknown error";
    console.error(`[ingest] document ${documentId} failed:`, err);

    // Record a readable error on the document. Same run-scoped guard as
    // finalize, so a delete or a newer run wins over this failure.
    try {
      await db
        .update(documentsTable)
        .set({ status: "error", error: message.slice(0, 1000), updatedAt: Date.now() })
        .where(
          and(
            eq(documentsTable.id, documentId),
            eq(documentsTable.tenantId, tenantId),
            eq(documentsTable.ingestionRunId, runId),
          ),
        );
    } catch (writeErr) {
      console.error(
        `[ingest] could not mark document ${documentId} as errored:`,
        writeErr,
      );
    }

    // Best-effort failure event; the recorder swallows its own errors.
    await resolveRecorder().record({
      tenantId,
      eventType: "ingestion",
      collectionId,
      documentId,
      authType: params.authType,
      apiKeyId: params.apiKeyId,
      status: "error",
      errorCode: "ingestion_failed",
      chunkCount: chunkCount || null,
      bytesProcessed: sizeBytes,
      latencyTotalMs: Date.now() - startedAt,
    });
  }
}

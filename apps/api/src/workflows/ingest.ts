import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { and, eq } from "drizzle-orm";
import type { Env, IngestMessage } from "../env";
import { getDb } from "../db";
import { documents as documentsTable } from "../db/schema";
import { extractPages, type PageText } from "../lib/extract";
import { chunkPages, type Chunk } from "../lib/chunking";
import { PermanentError } from "../lib/errors";
import { deleteByPrefix, documentPrefix, ingestArtifactKey } from "../lib/r2";
import { WorkersAiEmbeddingProvider } from "../services/embeddings";
import {
  PineconeVectorStore,
  vectorId,
  vectorNamespace,
} from "../services/vectorstore";
import {
  MAX_EMBED_BATCH_SIZE,
  VECTOR_TEXT_METADATA_MAX_CHARS,
} from "../config";

/**
 * Durable ingestion pipeline: parse → chunk → embed → upsert → finalize.
 *
 * Each phase is a `step.do(...)` with exponential-backoff retries, so a
 * transient failure resumes where it left off instead of redoing earlier work.
 * Deterministic failures (`PermanentError`: unparseable file, provider 4xx,
 * config mismatch) are mapped to `NonRetryableError` so the step fails fast;
 * any failure ends in a final "mark error" step that records a readable
 * message on the D1 row — a document never hangs in 'processing'.
 *
 * Idempotency: vector ids are deterministic (`{documentId}#{chunkIndex}`), so
 * re-running the pipeline (or a retried upsert step) overwrites vectors
 * instead of duplicating them.
 *
 * Extracted pages / chunks are staged as JSON in R2 next to the raw file
 * (`.ingest/` prefix) rather than returned from steps, keeping step state
 * under the Workflows per-step payload limit for large documents. They are
 * cleaned up in the finalize step.
 */

/** Retry/backoff applied to every step; tune here if providers get flaky. */
const STEP_CONFIG: WorkflowStepConfig = {
  retries: { limit: 4, delay: "5 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

/** Map PermanentError → NonRetryableError at the step boundary. */
function failFastOnPermanent(err: unknown): never {
  if (err instanceof PermanentError) throw new NonRetryableError(err.message);
  throw err;
}

export class IngestWorkflow extends WorkflowEntrypoint<Env, IngestMessage> {
  override async run(
    event: Readonly<WorkflowEvent<IngestMessage>>,
    step: WorkflowStep,
  ): Promise<void> {
    const { tenantId, collectionId, documentId } = event.payload;
    const db = getDb(this.env);

    try {
      // -- 1. Claim the document: 'processing' + record this instance -------
      const doc = await step.do("mark processing", STEP_CONFIG, async () => {
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
        if (!row) {
          throw new NonRetryableError("Document no longer exists");
        }
        await db
          .update(documentsTable)
          .set({
            status: "processing",
            error: null,
            workflowInstanceId: event.instanceId,
            updatedAt: Date.now(),
          })
          .where(eq(documentsTable.id, documentId));
        return { r2Key: row.r2Key, filename: row.filename, contentType: row.contentType };
      });

      // -- 2. Fetch from R2 and extract plain text (with page numbers) ------
      const extracted = await step.do("extract text", STEP_CONFIG, async () => {
        const object = await this.env.RAW_DOCS.get(doc.r2Key);
        if (!object) {
          throw new NonRetryableError("Source file is missing from storage");
        }
        let pages: PageText[];
        try {
          pages = await extractPages(await object.arrayBuffer(), doc.contentType);
        } catch (err) {
          failFastOnPermanent(err);
        }
        if (!pages.some((p) => p.text.trim())) {
          throw new NonRetryableError(
            "No extractable text found — the file is empty or contains no text layer (e.g. a scanned PDF)",
          );
        }
        const key = ingestArtifactKey(doc.r2Key, "extracted.json");
        await this.env.RAW_DOCS.put(key, JSON.stringify(pages), {
          httpMetadata: { contentType: "application/json" },
        });
        return { key, pageCount: pages.length };
      });

      // -- 3. Chunk (recursive character splitting with overlap) ------------
      const chunked = await step.do("chunk text", STEP_CONFIG, async () => {
        const pages = await this.readArtifact<PageText[]>(extracted.key);
        const chunks = chunkPages(pages);
        if (chunks.length === 0) {
          throw new NonRetryableError("Chunking produced no usable text");
        }
        const key = ingestArtifactKey(doc.r2Key, "chunks.json");
        await this.env.RAW_DOCS.put(key, JSON.stringify(chunks), {
          httpMetadata: { contentType: "application/json" },
        });
        return { key, chunkCount: chunks.length };
      });

      // -- 4. Preflight: embedding dimension must match the Pinecone index --
      await step.do("verify index dimension", STEP_CONFIG, async () => {
        try {
          const embedder = new WorkersAiEmbeddingProvider(this.env.AI);
          const store = new PineconeVectorStore(this.env);
          const indexDim = await store.indexDimension();
          if (indexDim !== null && indexDim !== embedder.dimension) {
            throw new PermanentError(
              `Pinecone index dimension (${indexDim}) does not match the embedding model dimension (${embedder.dimension}). ` +
                `Recreate the index with dimension ${embedder.dimension} (metric: cosine).`,
            );
          }
        } catch (err) {
          failFastOnPermanent(err);
        }
      });

      // -- 5. Embed + upsert, in batches of <= MAX_EMBED_BATCH_SIZE ---------
      // One step per batch: a transient provider failure only replays its own
      // batch, and completed batches are never re-embedded. Upserting inside
      // the same step avoids passing vectors through step state.
      const namespace = vectorNamespace(tenantId, collectionId);
      const batchCount = Math.ceil(chunked.chunkCount / MAX_EMBED_BATCH_SIZE);
      for (let batch = 0; batch < batchCount; batch++) {
        await step.do(
          `embed and upsert batch ${batch + 1} of ${batchCount}`,
          STEP_CONFIG,
          async () => {
            try {
              const chunks = await this.readArtifact<Chunk[]>(chunked.key);
              const slice = chunks.slice(
                batch * MAX_EMBED_BATCH_SIZE,
                (batch + 1) * MAX_EMBED_BATCH_SIZE,
              );
              const embedder = new WorkersAiEmbeddingProvider(this.env.AI);
              const { vectors } = await embedder.embed(slice.map((c) => c.text));

              const store = new PineconeVectorStore(this.env);
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
            } catch (err) {
              failFastOnPermanent(err);
            }
          },
        );
      }

      // -- 6. Finalize: clean up staging, mark 'ready' ----------------------
      await step.do("finalize", STEP_CONFIG, async () => {
        await deleteByPrefix(
          this.env.RAW_DOCS,
          `${documentPrefix(doc.r2Key)}.ingest/`,
        );
        await db
          .update(documentsTable)
          .set({
            status: "ready",
            error: null,
            chunkCount: chunked.chunkCount,
            ingestedAt: Date.now(),
            updatedAt: Date.now(),
          })
          .where(eq(documentsTable.id, documentId));
      });
    } catch (err) {
      // Any step that exhausted its retries (or failed fast) lands here:
      // record a readable error on the document, then let the instance error
      // so the failure is visible in Workflows observability too.
      // The Workflows runtime prefixes propagated step errors with the error
      // class name; strip it so the stored message reads cleanly in the UI.
      const message = (
        err instanceof Error ? err.message : "Ingestion failed with an unknown error"
      ).replace(/^(NonRetryableError|Error):\s*/, "");
      await step.do("mark error", STEP_CONFIG, async () => {
        await db
          .update(documentsTable)
          .set({ status: "error", error: message.slice(0, 1000), updatedAt: Date.now() })
          .where(
            and(
              eq(documentsTable.id, documentId),
              eq(documentsTable.tenantId, tenantId),
            ),
          );
      });
      throw err;
    }
  }

  /** Read a JSON staging artifact written by an earlier step. */
  private async readArtifact<T>(key: string): Promise<T> {
    const object = await this.env.RAW_DOCS.get(key);
    if (!object) {
      // Staging objects are only deleted at finalize; absence means something
      // external removed them — restart the pipeline rather than limp on.
      throw new NonRetryableError(
        "Ingestion staging data is missing; re-run ingestion for this document",
      );
    }
    return (await object.json()) as T;
  }
}

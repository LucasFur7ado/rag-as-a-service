import { after } from "next/server";
import { and, count, eq } from "drizzle-orm";
import type {
  QueryRequest,
  QueryResponse,
  QueryStreamEvent,
  QueryUsage,
  UsageEventStatus,
} from "@rag/shared";
import { rateLimitHeaders, requireAuth } from "@/server/lib/auth";
import { handler, json, preflight, readJson } from "@/server/lib/http";
import { ApiError, badRequest, conflict, notFound } from "@/server/lib/errors";
import { findOwnedCollection, getDb } from "@/server/db";
import { documents as documentsTable } from "@/server/db/schema";
import { estimateCost, MAX_QUERY_LENGTH, MAX_TOP_K, TOP_K } from "@/server/config";
import { countTokens } from "@/server/lib/tokens";
import {
  WorkersAiEmbeddingProvider,
  type EmbeddingProvider,
} from "@/server/services/embeddings";
import { PineconeVectorStore } from "@/server/services/vectorstore";
import { retrieveChunks, type RetrievalResult } from "@/server/services/retrieval";
import { assembleContext } from "@/server/services/context";
import { resolveCitations } from "@/server/services/citations";
import { GeminiLlmProvider, type LlmMessage } from "@/server/services/llm";
import { RAG_SYSTEM_PROMPT, buildUserPrompt } from "@/server/prompts";
import { resolveRecorder, type RecordEventInput } from "@/server/services/analytics";

/**
 * Query API (protected, tenant-scoped): POST /api/v1/collections/:id/query.
 *
 * Pipeline: embed query → retrieve (tenant+collection namespace, tenantId
 * filter) → assemble context (threshold/dedupe/budget/ordering) → generate
 * grounded answer → resolve citations. Each stage lives behind a service seam
 * (services/retrieval|context|citations|llm) — this route only validates,
 * orchestrates, and shapes the response.
 *
 * Response modes:
 * - default: SSE stream of QueryStreamEvents — `delta`* → `sources` → `done`
 *   (or `error`).
 * - `stream: false`: one JSON QueryResponse `{ answer, sources, usage }`.
 *
 * Analytics: every outcome — success, `no_results`, and pipeline errors — is
 * recorded via {@link recordUsage}, ALWAYS through `after()` and never awaited
 * before responding. Stage timings (embed / retrieval / generation) and token
 * counts are computed OFF the request path (inside the deferred closure), so
 * instrumentation adds no latency and a failing metric write cannot affect the
 * query response.
 */
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req, ctx: Ctx) => {
  const { auth, rateLimit } = await requireAuth(req);
  const { tenantId } = auth;
  const rlHeaders = rateLimit ? rateLimitHeaders(rateLimit) : {};

  // --- Validate the request ------------------------------------------------
  const body = await readJson<QueryRequest>(req);

  const question = typeof body.query === "string" ? body.query.trim() : "";
  if (!question) throw badRequest("`query` is required");
  if (question.length > MAX_QUERY_LENGTH) {
    throw badRequest(
      `\`query\` exceeds the maximum length of ${MAX_QUERY_LENGTH} characters`,
    );
  }
  if (
    body.topK !== undefined &&
    (typeof body.topK !== "number" || !Number.isFinite(body.topK))
  ) {
    throw badRequest("`topK` must be a number");
  }
  const topK = Math.min(Math.max(Math.floor(body.topK ?? TOP_K), 1), MAX_TOP_K);
  const wantStream = body.stream !== false;

  // --- Tenant-scoped collection lookup (404 for foreign/missing) -----------
  const { id } = await ctx.params;
  const db = getDb();
  const collection = await findOwnedCollection(db, tenantId, id);
  if (!collection) throw notFound("Collection not found");

  // Nothing ingested yet → say so instead of hallucinating over empty context.
  const [{ readyCount }] = await db
    .select({ readyCount: count() })
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.collectionId, collection.id),
        eq(documentsTable.tenantId, tenantId),
        eq(documentsTable.status, "ready"),
      ),
    );
  if (Number(readyCount) === 0) {
    throw conflict(
      "This collection has no ready documents yet. Upload a document and wait for ingestion to finish before querying.",
    );
  }

  // --- Analytics recording (all off the critical path) ---------------------
  // Fields common to every event for this request; per-outcome fields are
  // merged in at each exit. `answerText`/`promptText` are counted into tokens
  // INSIDE the deferred closure so token counting never runs on the hot path.
  const pipelineStart = Date.now();
  const llm = new GeminiLlmProvider();

  const recordUsage = (
    extra: Partial<RecordEventInput> & {
      status: UsageEventStatus;
      promptText?: string;
      answerText?: string;
    },
  ): void => {
    const { promptText, answerText, ...fields } = extra;
    try {
      after(async () => {
        // Token counting + cost happen here (deferred), not on the request path.
        let tokensPrompt: number | null = null;
        let tokensCompletion: number | null = null;
        let estimatedCost: number | null = null;
        if (answerText != null) {
          tokensPrompt = promptText ? countTokens(promptText) : null;
          tokensCompletion = countTokens(answerText);
          estimatedCost = estimateCost(
            llm.defaultModel,
            tokensPrompt,
            tokensCompletion,
          );
        }
        await resolveRecorder().record({
          tenantId,
          eventType: "query",
          collectionId: collection.id,
          authType: auth.authType,
          apiKeyId: auth.keyId ?? null,
          queryText: question,
          queryLength: question.length,
          tokensPrompt,
          tokensCompletion,
          estimatedCost,
          ...fields,
        });
      });
    } catch (err) {
      console.error("Failed to schedule query usage event:", err);
    }
  };

  // --- Retrieve ------------------------------------------------------------
  const embedder: EmbeddingProvider = new WorkersAiEmbeddingProvider();
  const store = new PineconeVectorStore();
  let retrieval: RetrievalResult;
  try {
    retrieval = await retrieveChunks(embedder, store, {
      tenantId,
      collectionId: collection.id,
      query: question,
      topK,
    });
  } catch (err) {
    recordUsage({
      status: "error",
      errorCode: "retrieval_failed",
      latencyTotalMs: Date.now() - pipelineStart,
    });
    throw err;
  }
  const retrieved = retrieval.chunks;
  const topScore = retrieved.length
    ? Math.max(...retrieved.map((r) => r.score))
    : null;

  // TODO (next): re-ranking — a cross-encoder over `retrieved` slots in here,
  // before context assembly, to re-score the top-k on the actual question.

  // --- Assemble context ----------------------------------------------------
  const context = assembleContext(retrieved);
  if (context.sources.length === 0) {
    // A successful search that surfaced nothing relevant — a distinct outcome.
    recordUsage({
      status: "no_results",
      errorCode: "no_relevant_content",
      latencyEmbedMs: retrieval.embedMs,
      latencyRetrievalMs: retrieval.retrievalMs,
      chunksRetrieved: retrieved.length,
      topScore,
      latencyTotalMs: Date.now() - pipelineStart,
    });
    throw new ApiError(
      422,
      "No relevant content found for this question in the collection's documents. Try rephrasing, or check that the relevant document finished ingesting.",
    );
  }

  // --- Generate ------------------------------------------------------------
  const userPrompt = buildUserPrompt(context.contextText, question);
  const promptText = `${RAG_SYSTEM_PROMPT}\n\n${userPrompt}`;
  const messages: LlmMessage[] = [
    { role: "system", content: RAG_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  const buildUsage = (invalidMarkers: number[]): QueryUsage => ({
    chunksRetrieved: retrieved.length,
    chunksUsed: context.sources.length,
    contextTokens: context.contextTokens,
    invalidMarkers,
    model: llm.defaultModel,
  });

  if (!wantStream) {
    const genStart = Date.now();
    let completion;
    try {
      completion = await llm.complete({ messages });
    } catch (err) {
      recordUsage({
        status: "error",
        errorCode: "generation_failed",
        latencyEmbedMs: retrieval.embedMs,
        latencyRetrievalMs: retrieval.retrievalMs,
        latencyGenerationMs: Date.now() - genStart,
        chunksRetrieved: retrieved.length,
        topScore,
        latencyTotalMs: Date.now() - pipelineStart,
      });
      throw err;
    }
    const generationMs = Date.now() - genStart;
    const { sources, invalidMarkers } = resolveCitations(
      completion.text,
      context.sources,
    );
    recordUsage({
      status: "success",
      latencyEmbedMs: retrieval.embedMs,
      latencyRetrievalMs: retrieval.retrievalMs,
      latencyGenerationMs: generationMs,
      chunksRetrieved: retrieved.length,
      topScore,
      latencyTotalMs: Date.now() - pipelineStart,
      promptText,
      answerText: completion.text,
    });
    const response: QueryResponse = {
      answer: completion.text,
      sources,
      usage: buildUsage(invalidMarkers),
    };
    return json(response, 200, rlHeaders);
  }

  // --- Streaming (SSE) -----------------------------------------------------
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: QueryStreamEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      const genStart = Date.now();
      let answer = "";
      try {
        for await (const delta of llm.stream({ messages })) {
          answer += delta;
          send({ type: "delta", text: delta });
        }
        const generationMs = Date.now() - genStart;
        const { sources, invalidMarkers } = resolveCitations(answer, context.sources);
        send({ type: "sources", sources, usage: buildUsage(invalidMarkers) });
        send({ type: "done" });
        recordUsage({
          status: "success",
          latencyEmbedMs: retrieval.embedMs,
          latencyRetrievalMs: retrieval.retrievalMs,
          latencyGenerationMs: generationMs,
          chunksRetrieved: retrieved.length,
          topScore,
          latencyTotalMs: Date.now() - pipelineStart,
          promptText,
          answerText: answer,
        });
      } catch (err) {
        // Headers are already sent (200), so failures must travel in-band.
        console.error("Query generation failed:", err);
        send({
          type: "error",
          message: "Answer generation failed — please try again.",
        });
        recordUsage({
          status: "error",
          errorCode: "generation_failed",
          latencyEmbedMs: retrieval.embedMs,
          latencyRetrievalMs: retrieval.retrievalMs,
          latencyGenerationMs: Date.now() - genStart,
          chunksRetrieved: retrieved.length,
          topScore,
          latencyTotalMs: Date.now() - pipelineStart,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Vercel's proxy buffers responses by default; this opts the SSE stream
      // out so deltas reach the browser as they are produced rather than all
      // at once when generation finishes.
      "X-Accel-Buffering": "no",
      ...rlHeaders,
    },
  });
});

export const OPTIONS = preflight;

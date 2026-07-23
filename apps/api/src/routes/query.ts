import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { and, count, eq } from "drizzle-orm";
import type {
  QueryRequest,
  QueryResponse,
  QueryStreamEvent,
  QueryUsage,
} from "@rag/shared";
import type { AppBindings } from "../env";
import { requireAuth } from "../lib/auth";
import { findOwnedCollection, getDb } from "../db";
import { documents as documentsTable } from "../db/schema";
import { MAX_QUERY_LENGTH, MAX_TOP_K, TOP_K } from "../config";
import { WorkersAiEmbeddingProvider } from "../services/embeddings";
import { PineconeVectorStore } from "../services/vectorstore";
import { retrieveChunks } from "../services/retrieval";
import { assembleContext } from "../services/context";
import { resolveCitations } from "../services/citations";
import { WorkersAiLlmProvider, type LlmMessage } from "../services/llm";
import { RAG_SYSTEM_PROMPT, buildUserPrompt } from "../prompts";

/**
 * Query API (protected, tenant-scoped): POST /v1/collections/:id/query.
 *
 * Pipeline: embed query → retrieve (tenant+collection namespace, tenantId
 * filter) → assemble context (threshold/dedupe/budget/ordering) → generate
 * grounded answer → resolve citations. Each stage lives behind a service
 * seam (services/retrieval|context|citations|llm) — this route only
 * validates, orchestrates, and shapes the response.
 *
 * Response modes:
 * - default: SSE stream of QueryStreamEvents — `delta`* → `sources` → `done`
 *   (or `error`).
 * - `stream: false`: one JSON QueryResponse `{ answer, sources, usage }`.
 */
export const query = new Hono<AppBindings>();

query.use("*", requireAuth);

query.post("/:id/query", async (c) => {
  const { tenantId } = c.get("auth");

  // --- Validate the request ------------------------------------------------
  let body: QueryRequest;
  try {
    body = await c.req.json<QueryRequest>();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }

  const question = typeof body.query === "string" ? body.query.trim() : "";
  if (!question) {
    throw new HTTPException(400, { message: "`query` is required" });
  }
  if (question.length > MAX_QUERY_LENGTH) {
    throw new HTTPException(400, {
      message: `\`query\` exceeds the maximum length of ${MAX_QUERY_LENGTH} characters`,
    });
  }
  if (body.topK !== undefined && (typeof body.topK !== "number" || !Number.isFinite(body.topK))) {
    throw new HTTPException(400, { message: "`topK` must be a number" });
  }
  const topK = Math.min(Math.max(Math.floor(body.topK ?? TOP_K), 1), MAX_TOP_K);
  const wantStream = body.stream !== false;

  // --- Tenant-scoped collection lookup (404 for foreign/missing) -----------
  const db = getDb(c.env);
  const collection = await findOwnedCollection(db, tenantId, c.req.param("id"));
  if (!collection) throw new HTTPException(404, { message: "Collection not found" });

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
  if (readyCount === 0) {
    throw new HTTPException(409, {
      message:
        "This collection has no ready documents yet. Upload a document and wait for ingestion to finish before querying.",
    });
  }

  // --- Retrieve ------------------------------------------------------------
  const embedder = new WorkersAiEmbeddingProvider(c.env.AI);
  const store = new PineconeVectorStore(c.env);
  const retrieved = await retrieveChunks(embedder, store, {
    tenantId,
    collectionId: collection.id,
    query: question,
    topK,
  });

  // TODO (next): re-ranking — a cross-encoder over `retrieved` slots in here,
  // before context assembly, to re-score the top-k on the actual question.

  // --- Assemble context ----------------------------------------------------
  const context = assembleContext(retrieved);
  if (context.sources.length === 0) {
    throw new HTTPException(422, {
      message:
        "No relevant content found for this question in the collection's documents. Try rephrasing, or check that the relevant document finished ingesting.",
    });
  }

  // --- Generate ------------------------------------------------------------
  const llm = new WorkersAiLlmProvider(c.env.AI);
  const messages: LlmMessage[] = [
    { role: "system", content: RAG_SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(context.contextText, question) },
  ];

  const buildUsage = (invalidMarkers: number[]): QueryUsage => ({
    chunksRetrieved: retrieved.length,
    chunksUsed: context.sources.length,
    contextTokens: context.contextTokens,
    invalidMarkers,
    model: llm.defaultModel,
  });

  if (!wantStream) {
    const completion = await llm.complete({ messages });
    const { sources, invalidMarkers } = resolveCitations(
      completion.text,
      context.sources,
    );
    const response: QueryResponse = {
      answer: completion.text,
      sources,
      usage: buildUsage(invalidMarkers),
    };
    return c.json(response);
  }

  return streamSSE(c, async (stream) => {
    const send = (event: QueryStreamEvent) =>
      stream.writeSSE({ data: JSON.stringify(event) });

    let answer = "";
    try {
      for await (const delta of llm.stream({ messages })) {
        answer += delta;
        await send({ type: "delta", text: delta });
      }
      const { sources, invalidMarkers } = resolveCitations(answer, context.sources);
      await send({ type: "sources", sources, usage: buildUsage(invalidMarkers) });
      await send({ type: "done" });
    } catch (err) {
      // Headers are already sent (200), so failures must travel in-band.
      console.error("Query generation failed:", err);
      await send({
        type: "error",
        message: "Answer generation failed — please try again.",
      });
    }
  });
});

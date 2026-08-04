/** Query pipeline Zod schemas — source of truth for the API and web app. */
import { z } from "zod";

/**
 * Body for POST /v1/collections/:id/query. The collection is addressed by the
 * URL path; the body carries only the question and tuning overrides.
 */
export const QueryRequestSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .meta({ example: "What is the refund policy for annual plans?" }),
    topK: z
      .number()
      .int()
      .optional()
      .meta({ example: 8, description: "Max source chunks to retrieve (server clamps to a sane range)." }),
    stream: z.boolean().optional().meta({
      example: false,
      description:
        "`true`/omitted → Server-Sent Events stream of query events; `false` → a single JSON QueryResponse.",
    }),
  })
  .meta({ id: "QueryRequest" });

/**
 * A citation pointing back to the source chunk that grounded (part of) an
 * answer. `marker` is the `[n]` label the model was told to cite with.
 */
export const CitationSchema = z
  .object({
    marker: z.number().int().meta({ example: 1, description: "1-based `[n]` label used in the answer." }),
    documentId: z.string().meta({ example: "doc_4c1e77a0" }),
    filename: z.string().meta({ example: "handbook.pdf" }),
    page: z
      .number()
      .int()
      .nullable()
      .meta({ example: 12, description: "1-based page number for paged sources (PDF); null otherwise." }),
    chunkIndex: z.number().int().meta({ example: 5 }),
    snippet: z
      .string()
      .meta({ example: "Annual plans are eligible for a full refund within 30 days of purchase…" }),
    score: z.number().meta({ example: 0.82, description: "Similarity score in [0, 1] from the vector store." }),
    cited: z.boolean().meta({ example: true, description: "Whether the model actually cited this source." }),
  })
  .meta({ id: "Citation" });

/** Retrieval/generation accounting returned with every query response. */
export const QueryUsageSchema = z
  .object({
    chunksRetrieved: z.number().int().meta({ example: 8 }),
    chunksUsed: z.number().int().meta({ example: 5 }),
    contextTokens: z.number().int().meta({ example: 1240 }),
    invalidMarkers: z
      .array(z.number().int())
      .meta({ example: [], description: "Markers the model emitted that map to no retrieved chunk." }),
    model: z.string().meta({ example: "gemini-2.5-flash" }),
  })
  .meta({ id: "QueryUsage" });

/** The non-streaming (`stream: false`) response shape. */
export const QueryResponseSchema = z
  .object({
    answer: z.string().meta({
      example:
        "Annual plans can be refunded in full within 30 days of purchase [1]. After 30 days, refunds are prorated [2].",
      description: "Generated answer (markdown, with inline `[n]` citation markers).",
    }),
    sources: z.array(CitationSchema),
    usage: QueryUsageSchema,
  })
  .meta({ id: "QueryResponse" });

// --- Streaming query events (SSE; each `data:` line is one JSON event) -------

export const QueryDeltaEventSchema = z
  .object({ type: z.literal("delta"), text: z.string().meta({ example: "Annual plans " }) })
  .meta({ id: "QueryDeltaEvent" });

export const QuerySourcesEventSchema = z
  .object({
    type: z.literal("sources"),
    sources: z.array(CitationSchema),
    usage: QueryUsageSchema,
  })
  .meta({ id: "QuerySourcesEvent" });

export const QueryDoneEventSchema = z
  .object({ type: z.literal("done") })
  .meta({ id: "QueryDoneEvent" });

export const QueryErrorEventSchema = z
  .object({ type: z.literal("error"), message: z.string().meta({ example: "Answer generation failed — please try again." }) })
  .meta({ id: "QueryErrorEvent" });

export const QueryStreamEventSchema = z
  .discriminatedUnion("type", [
    QueryDeltaEventSchema,
    QuerySourcesEventSchema,
    QueryDoneEventSchema,
    QueryErrorEventSchema,
  ])
  .meta({ id: "QueryStreamEvent" });

/**
 * Body of a 429 Too Many Requests response from a rate-limited endpoint. The
 * response also carries `Retry-After` and `RateLimit-*` headers.
 */
export const RateLimitErrorBodySchema = z
  .object({
    error: z.string().meta({ example: "Rate limit exceeded" }),
    retryAfter: z.number().int().meta({ example: 30, description: "Seconds until the caller may retry (mirrors Retry-After)." }),
    limit: z.number().int().meta({ example: 60, description: "The limit that was exceeded (requests per minute)." }),
  })
  .meta({ id: "RateLimitErrorBody" });

/**
 * OpenAPI documentation layer (Feature 6).
 *
 * Every operation is registered here from the SAME Zod schemas that
 * `packages/shared` exports (the single source of truth used for the app's
 * TypeScript types and, conceptually, its validation). Documentation is kept
 * separate from the runtime routers on purpose: the existing handlers in
 * `src/routes/*` do their own validation and return bespoke error messages, so
 * letting `@hono/zod-openapi`'s automatic request validation intercept them
 * would change response bodies (a hard "no behavior change" violation — see
 * Feature 6 report). Registering paths instead documents the real contract
 * without touching a single line of request handling.
 *
 * Changing a schema in `packages/shared` therefore flows straight into this
 * spec (and the web reference generated from it) with no edits here.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import {
  ErrorSchema,
  RateLimitErrorBodySchema,
  AuthContextSchema,
  CollectionResponseSchema,
  CreateCollectionRequestSchema,
  ListCollectionsResponseSchema,
  DocumentResponseSchema,
  ListDocumentsResponseSchema,
  UploadDocumentResponseSchema,
  UploadDocumentBodySchema,
  DocumentStatusResponseSchema,
  ReingestDocumentResponseSchema,
  QueryRequestSchema,
  QueryResponseSchema,
  CreateApiKeyRequestSchema,
  ApiKeyCreateResponseSchema,
  ListApiKeysResponseSchema,
  AnalyticsSummarySchema,
  TimeseriesResponseSchema,
  BreakdownResponseSchema,
  RecentEventsResponseSchema,
  IngestionStatsSchema,
} from "@rag/shared";
import type { AppBindings } from "../env";

type App = OpenAPIHono<AppBindings>;
type Registry = App["openAPIRegistry"];

// --- Security scheme references ---------------------------------------------
/** OpenAPI security requirement: a map of scheme name → required scopes ([]). */
type SecurityRequirement = Record<string, string[]>;
/** Accepts either an API key or a Clerk session (the public product surface). */
const SEC_ANY: SecurityRequirement[] = [{ ApiKeyAuth: [] }, { SessionAuth: [] }];
/** Dashboard-only: a Clerk session, never an API key. */
const SEC_SESSION: SecurityRequirement[] = [{ SessionAuth: [] }];

// --- Reusable response headers ----------------------------------------------
/** IETF-draft RateLimit headers set on every API-key response. */
const RATE_LIMIT_HEADERS = {
  "RateLimit-Limit": {
    schema: { type: "integer" as const },
    description: "Requests allowed per minute for the presented API key.",
  },
  "RateLimit-Remaining": {
    schema: { type: "integer" as const },
    description: "Requests remaining in the current sliding window.",
  },
  "RateLimit-Reset": {
    schema: { type: "integer" as const },
    description: "Seconds until the window frees capacity.",
  },
};
/** The 429 response additionally carries Retry-After. */
const RATE_LIMIT_429_HEADERS = {
  ...RATE_LIMIT_HEADERS,
  "Retry-After": {
    schema: { type: "integer" as const },
    description: "Seconds the caller should wait before retrying.",
  },
};

// --- Response builders ------------------------------------------------------
const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const err = (description: string) => json(ErrorSchema, description);

/** 429 body plus the RateLimit and Retry-After headers (API-key endpoints only). */
const RESP_429 = {
  description: "Rate limit exceeded — too many requests for this API key.",
  headers: RATE_LIMIT_429_HEADERS,
  content: { "application/json": { schema: RateLimitErrorBodySchema } },
};
const RESP_401 = err("Missing, invalid, or expired credentials.");
const RESP_404 = (what: string) => err(`${what} not found (or owned by another tenant).`);
const RESP_400 = err("Invalid request — malformed body or failed a field constraint.");

/** Path param `{id}`. Value is opaque; example aids the docs + Try-it console. */
const idParam = (example: string) =>
  z.object({ id: z.string().meta({ example }) });

/** Shared analytics range/filter query params (strings: epoch ms or ISO). */
const analyticsRangeQuery = z.object({
  from: z
    .string()
    .optional()
    .meta({ example: "1753200000000", description: "Inclusive window start — epoch ms or ISO-8601. Defaults to 7 days ago." }),
  to: z
    .string()
    .optional()
    .meta({ example: "1753800000000", description: "Exclusive window end — epoch ms or ISO-8601. Defaults to now." }),
  collectionId: z
    .string()
    .optional()
    .meta({ example: "col_9f8b2a1c", description: "Restrict to a single collection." }),
});

const HealthResponseSchema = z
  .object({
    status: z.string().meta({ example: "ok" }),
    version: z.string().meta({ example: "0.1.0" }),
    service: z.string().meta({ example: "rag-api" }),
  })
  .meta({ id: "HealthResponse" });

/**
 * Register every operation on the app's OpenAPI registry. Called once at module
 * load from src/index.ts, before the spec-serving endpoints.
 */
export function registerOpenApi(app: App): void {
  const r: Registry = app.openAPIRegistry;

  // Security schemes (both are HTTP bearer, but semantically distinct — one is
  // a `rag_live_…` API key, the other a Clerk session JWT).
  r.registerComponent("securitySchemes", "ApiKeyAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "rag_live_...",
    description:
      "Programmatic API key. Send `Authorization: Bearer rag_live_…` (or the " +
      "`X-API-Key` header). Rate-limited per key; responses carry RateLimit-* headers.",
  });
  r.registerComponent("securitySchemes", "SessionAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "Clerk session JWT from the dashboard SPA. Required for API-key management " +
      "and analytics endpoints, which never accept an API key.",
  });

  // --- Health (public) ------------------------------------------------------
  r.registerPath({
    method: "get",
    path: "/health",
    tags: ["Health"],
    summary: "Service health check",
    description: "Public liveness probe. No authentication required.",
    responses: { 200: json(HealthResponseSchema, "Service is up.") },
  });

  // --- Me (any auth) --------------------------------------------------------
  r.registerPath({
    method: "get",
    path: "/me",
    tags: ["Health"],
    summary: "Current authenticated principal",
    description: "Returns the tenant + auth type resolved from the presented credential.",
    security: SEC_ANY,
    responses: {
      200: { ...json(AuthContextSchema, "The authenticated principal."), headers: RATE_LIMIT_HEADERS },
      401: RESP_401,
      429: RESP_429,
    },
  });

  // --- Collections ----------------------------------------------------------
  r.registerPath({
    method: "post",
    path: "/v1/collections",
    tags: ["Collections"],
    summary: "Create a collection",
    description: "Create a new, empty collection scoped to the caller's tenant.",
    security: SEC_ANY,
    request: {
      body: { content: { "application/json": { schema: CreateCollectionRequestSchema } }, required: true },
    },
    responses: {
      201: { ...json(CollectionResponseSchema, "Collection created."), headers: RATE_LIMIT_HEADERS },
      400: RESP_400,
      401: RESP_401,
      429: RESP_429,
    },
  });
  r.registerPath({
    method: "get",
    path: "/v1/collections",
    tags: ["Collections"],
    summary: "List collections",
    description: "List every collection owned by the caller's tenant, newest first.",
    security: SEC_ANY,
    responses: {
      200: { ...json(ListCollectionsResponseSchema, "The tenant's collections."), headers: RATE_LIMIT_HEADERS },
      401: RESP_401,
      429: RESP_429,
    },
  });
  r.registerPath({
    method: "get",
    path: "/v1/collections/{id}",
    tags: ["Collections"],
    summary: "Get a collection",
    security: SEC_ANY,
    request: { params: idParam("col_9f8b2a1c") },
    responses: {
      200: { ...json(CollectionResponseSchema, "The collection."), headers: RATE_LIMIT_HEADERS },
      401: RESP_401,
      404: RESP_404("Collection"),
      429: RESP_429,
    },
  });
  r.registerPath({
    method: "delete",
    path: "/v1/collections/{id}",
    tags: ["Collections"],
    summary: "Delete a collection",
    description:
      "Delete the collection, its documents' metadata + R2 objects, and its vector namespace. Irreversible.",
    security: SEC_ANY,
    request: { params: idParam("col_9f8b2a1c") },
    responses: {
      204: { description: "Deleted." },
      401: RESP_401,
      404: RESP_404("Collection"),
      429: RESP_429,
    },
  });

  // --- Documents (upload/list live under the parent collection) -------------
  r.registerPath({
    method: "post",
    path: "/v1/collections/{id}/documents",
    tags: ["Documents"],
    summary: "Upload a document",
    description:
      "Upload a source file (PDF, plain text, or Markdown, ≤ 25 MB) as `multipart/form-data` " +
      "with a `file` field. The document is stored and queued for async ingestion; it starts " +
      "at status `uploaded`. Poll `GET /v1/documents/{id}/status` for progress.",
    security: SEC_ANY,
    request: {
      params: idParam("col_9f8b2a1c"),
      body: { content: { "multipart/form-data": { schema: UploadDocumentBodySchema } }, required: true },
    },
    responses: {
      201: { ...json(UploadDocumentResponseSchema, "Document accepted; ingestion queued."), headers: RATE_LIMIT_HEADERS },
      400: err("Missing `file` field or the body was not multipart/form-data."),
      401: RESP_401,
      404: RESP_404("Collection"),
      413: err("File exceeds the 25 MB upload limit."),
      415: err("Unsupported file type. Accepted: PDF, plain text, Markdown."),
      429: RESP_429,
    },
  });
  r.registerPath({
    method: "get",
    path: "/v1/collections/{id}/documents",
    tags: ["Documents"],
    summary: "List documents in a collection",
    security: SEC_ANY,
    request: { params: idParam("col_9f8b2a1c") },
    responses: {
      200: { ...json(ListDocumentsResponseSchema, "Documents in the collection, newest first."), headers: RATE_LIMIT_HEADERS },
      401: RESP_401,
      404: RESP_404("Collection"),
      429: RESP_429,
    },
  });
  r.registerPath({
    method: "get",
    path: "/v1/documents/{id}",
    tags: ["Documents"],
    summary: "Get a document",
    security: SEC_ANY,
    request: { params: idParam("doc_4c1e77a0") },
    responses: {
      200: { ...json(DocumentResponseSchema, "The document metadata."), headers: RATE_LIMIT_HEADERS },
      401: RESP_401,
      404: RESP_404("Document"),
      429: RESP_429,
    },
  });
  r.registerPath({
    method: "get",
    path: "/v1/documents/{id}/status",
    tags: ["Documents"],
    summary: "Get ingestion status",
    description: "Lightweight polling endpoint for ingestion progress.",
    security: SEC_ANY,
    request: { params: idParam("doc_4c1e77a0") },
    responses: {
      200: { ...json(DocumentStatusResponseSchema, "Current ingestion status."), headers: RATE_LIMIT_HEADERS },
      401: RESP_401,
      404: RESP_404("Document"),
      429: RESP_429,
    },
  });
  r.registerPath({
    method: "post",
    path: "/v1/documents/{id}/reingest",
    tags: ["Documents"],
    summary: "Re-run ingestion",
    description:
      "Re-run the ingestion pipeline for a document (e.g. after tuning chunking). Safe to repeat — " +
      "vector ids are deterministic, so a re-run overwrites rather than duplicates.",
    security: SEC_ANY,
    request: { params: idParam("doc_4c1e77a0") },
    responses: {
      202: { ...json(ReingestDocumentResponseSchema, "Re-ingestion queued."), headers: RATE_LIMIT_HEADERS },
      401: RESP_401,
      404: RESP_404("Document"),
      409: err("Document is already being processed."),
      429: RESP_429,
    },
  });
  r.registerPath({
    method: "get",
    path: "/v1/documents/{id}/raw",
    tags: ["Documents"],
    summary: "Download the original file",
    description: "Streams the original uploaded bytes back from storage.",
    security: SEC_ANY,
    request: { params: idParam("doc_4c1e77a0") },
    responses: {
      200: {
        description: "The original file bytes.",
        content: { "application/octet-stream": { schema: z.string().meta({ format: "binary" }) } },
      },
      401: RESP_401,
      404: RESP_404("Document"),
      429: RESP_429,
    },
  });
  r.registerPath({
    method: "delete",
    path: "/v1/documents/{id}",
    tags: ["Documents"],
    summary: "Delete a document",
    description: "Delete a document's vectors, R2 objects, and metadata row. Irreversible.",
    security: SEC_ANY,
    request: { params: idParam("doc_4c1e77a0") },
    responses: {
      204: { description: "Deleted." },
      401: RESP_401,
      404: RESP_404("Document"),
      429: RESP_429,
    },
  });

  // --- Query ----------------------------------------------------------------
  r.registerPath({
    method: "post",
    path: "/v1/collections/{id}/query",
    tags: ["Query"],
    summary: "Ask a grounded question",
    description:
      "Run the RAG pipeline over a collection: embed the question → retrieve → assemble context " +
      "→ generate a grounded answer with `[n]` citation markers.\n\n" +
      "**Response modes** (chosen by the `stream` field):\n" +
      "- `stream` omitted or `true` (default): a `text/event-stream` of Server-Sent Events. Each " +
      "`data:` line is one JSON event. Order: zero or more `{\"type\":\"delta\",\"text\":\"…\"}` " +
      "(incremental answer text), then one `{\"type\":\"sources\", sources, usage}` (resolved " +
      "citations + accounting), then `{\"type\":\"done\"}`. On failure a single " +
      "`{\"type\":\"error\",\"message\":\"…\"}` is emitted and the stream ends.\n" +
      "- `stream: false`: a single JSON `QueryResponse` `{ answer, sources, usage }` — convenient " +
      "for curl and offline evaluation.",
    security: SEC_ANY,
    request: {
      params: idParam("col_9f8b2a1c"),
      body: { content: { "application/json": { schema: QueryRequestSchema } }, required: true },
    },
    responses: {
      200: {
        description:
          "The grounded answer. `text/event-stream` when streaming (default), or a JSON QueryResponse when `stream: false`.",
        headers: RATE_LIMIT_HEADERS,
        content: {
          "text/event-stream": {
            schema: z
              .string()
              .meta({ description: "SSE stream of newline-delimited JSON query events (see description)." }),
          },
          "application/json": { schema: QueryResponseSchema },
        },
      },
      400: err("Missing/empty `query`, `query` too long, or `topK` not a number."),
      401: RESP_401,
      404: RESP_404("Collection"),
      409: err("The collection has no ready documents yet — upload and wait for ingestion."),
      422: err("No relevant content found for the question in the collection."),
      429: RESP_429,
    },
  });

  // --- API keys (session-only) ----------------------------------------------
  r.registerPath({
    method: "post",
    path: "/v1/api-keys",
    tags: ["API Keys"],
    summary: "Create an API key",
    description:
      "Mint a new API key. The plaintext `key` is returned exactly once in this response and never " +
      "again — store it securely. Session-only: an API key cannot create keys.",
    security: SEC_SESSION,
    request: {
      body: { content: { "application/json": { schema: CreateApiKeyRequestSchema } }, required: true },
    },
    responses: {
      201: json(ApiKeyCreateResponseSchema, "Key created; `key` shown once."),
      400: RESP_400,
      401: err("Missing session, or an API key was presented (keys cannot manage keys)."),
    },
  });
  r.registerPath({
    method: "get",
    path: "/v1/api-keys",
    tags: ["API Keys"],
    summary: "List API keys",
    description: "List the tenant's API keys. Never returns key material.",
    security: SEC_SESSION,
    responses: {
      200: json(ListApiKeysResponseSchema, "The tenant's API keys."),
      401: RESP_401,
    },
  });
  r.registerPath({
    method: "delete",
    path: "/v1/api-keys/{id}",
    tags: ["API Keys"],
    summary: "Revoke an API key",
    description: "Revoke (soft-delete) a key. Takes effect immediately.",
    security: SEC_SESSION,
    request: { params: idParam("key_1a2b3c4d") },
    responses: {
      204: { description: "Revoked." },
      401: RESP_401,
      404: RESP_404("API key"),
    },
  });

  // --- Analytics (session-only) ---------------------------------------------
  const analyticsPaths: Array<{ path: string; summary: string; schema: z.ZodType; query: z.ZodObject }> = [
    { path: "summary", summary: "KPI summary", schema: AnalyticsSummarySchema, query: analyticsRangeQuery },
    {
      path: "timeseries",
      summary: "Query volume time series",
      schema: TimeseriesResponseSchema,
      query: analyticsRangeQuery.extend({
        granularity: z.enum(["hour", "day"]).optional().meta({ example: "day" }),
      }),
    },
    { path: "breakdown", summary: "Breakdowns by collection/status/auth", schema: BreakdownResponseSchema, query: analyticsRangeQuery },
    {
      path: "recent",
      summary: "Recent events (paginated)",
      schema: RecentEventsResponseSchema,
      query: analyticsRangeQuery.extend({
        status: z.enum(["success", "error", "rate_limited", "no_results"]).optional(),
        limit: z.string().optional().meta({ example: "25", description: "Page size (1–100)." }),
        cursor: z.string().optional().meta({ description: "Opaque cursor from a previous page's `nextCursor`." }),
      }),
    },
    { path: "ingestion", summary: "Ingestion statistics", schema: IngestionStatsSchema, query: analyticsRangeQuery },
  ];
  for (const a of analyticsPaths) {
    r.registerPath({
      method: "get",
      path: `/v1/analytics/${a.path}`,
      tags: ["Analytics"],
      summary: a.summary,
      description: "Dashboard analytics. Session-only — API keys are rejected. Tenant-scoped.",
      security: SEC_SESSION,
      request: { query: a.query },
      responses: {
        200: json(a.schema, a.summary),
        400: err("Invalid range: `from` must be a valid timestamp before `to`."),
        401: RESP_401,
      },
    });
  }

  // --- The spec itself (public) ---------------------------------------------
  const specResponse = json(
    z.object({}).meta({ description: "An OpenAPI 3.1 document." }),
    "The OpenAPI 3.1 specification for this API.",
  );
  r.registerPath({
    method: "get",
    path: "/v1/openapi.json",
    tags: ["Meta"],
    summary: "OpenAPI spec (JSON)",
    description: "The machine-readable OpenAPI 3.1 document describing this API. Public, cached.",
    responses: { 200: specResponse },
  });
  r.registerPath({
    method: "get",
    path: "/v1/openapi.yaml",
    tags: ["Meta"],
    summary: "OpenAPI spec (YAML)",
    description: "The OpenAPI 3.1 document as YAML. Public, cached.",
    responses: { 200: { description: "The OpenAPI 3.1 specification (YAML).", content: { "application/yaml": { schema: z.string() } } } },
  });
}

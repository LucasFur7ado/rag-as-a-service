import type { AuthContext, AuthType } from "@rag/shared";
import type { RateLimiter } from "./durable/ratelimiter";

/**
 * Message shape enqueued on INGEST_QUEUE for async document ingestion. The
 * queue consumer (src/index.ts) starts an IngestWorkflow instance with this
 * as its params.
 */
export interface IngestMessage {
  tenantId: string;
  collectionId: string;
  documentId: string;
  /**
   * How the request that triggered ingestion authenticated — carried through
   * for usage analytics (Feature 5). Optional for backward-compat with any
   * message enqueued before this field existed; the workflow defaults it.
   */
  authType?: AuthType;
  /** API key id when `authType === 'apikey'`; null/absent otherwise. */
  apiKeyId?: string | null;
}

/**
 * Strongly-typed environment for the worker: every binding declared in
 * wrangler.jsonc plus the secrets/vars the app expects at runtime.
 *
 * Binding types (`Ai`, `KVNamespace`, `Queue`, `Workflow`) come from
 * `@cloudflare/workers-types`.
 */
export interface Env {
  // --- Secrets / vars (see apps/api/.dev.vars.example) ---------------------
  /** Clerk Frontend API URL, e.g. https://your-app.clerk.accounts.dev */
  CLERK_ISSUER: string;
  /**
   * REQUIRED. Origin(s) of our own frontend, comma-separated — checked against
   * the session token's `azp` claim. `iss` only proves the token came from our
   * Clerk instance; `azp` is what pins it to our app, so auth fails closed when
   * this is unset (see verifyClerkToken in lib/auth.ts).
   */
  CLERK_AUTHORIZED_PARTY: string;
  /** Pinecone API key (secret, `wrangler secret put PINECONE_API_KEY`). */
  PINECONE_API_KEY: string;
  /** Pinecone index name (var; informational — the data plane uses the host). */
  PINECONE_INDEX: string;
  /**
   * Pinecone index host (var), e.g. `my-index-abc1234.svc.aped-1234-a56b.pinecone.io`
   * — shown on the index page in the Pinecone console. Scheme optional.
   */
  PINECONE_INDEX_HOST: string;
  /** Origin(s) of the web SPA allowed by CORS, comma-separated. */
  WEB_ORIGIN: string;
  /**
   * Public/production base URL of this API, advertised as the primary server in
   * the generated OpenAPI spec (Feature 6). Optional — when absent the spec
   * falls back to the request origin plus local dev. No trailing slash.
   */
  PUBLIC_API_URL?: string;

  // --- Bindings (declared in wrangler.jsonc) -----------------------------
  /** Workers AI. */
  AI: Ai;
  /** Producer handle for the async ingestion queue. */
  INGEST_QUEUE: Queue<IngestMessage>;
  /** Durable ingestion workflow. */
  INGEST_WORKFLOW: Workflow;
  /** KV namespace: read-optimized cache of API-key hashes for the auth path. */
  KV: KVNamespace;
  /** D1 database for collections/documents/api-keys metadata (Drizzle schema). */
  DB: D1Database;
  /** R2 bucket holding the raw uploaded documents. */
  RAW_DOCS: R2Bucket;
  /** Per-API-key rate limiter (Durable Object, atomic sliding-window counter). */
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  /**
   * Workers Analytics Engine dataset for usage events (Feature 5). Optional:
   * when bound, events are dual-written here in addition to D1 (the correct
   * backend at high write volume — see services/analytics.ts). Absent in
   * environments that only use D1.
   */
  USAGE_ANALYTICS?: AnalyticsEngineDataset;
}

/**
 * Hono generics for this app. `Variables.auth` is populated by the auth
 * middleware after a valid Clerk JWT is verified.
 */
export interface AppBindings {
  Bindings: Env;
  Variables: {
    auth: AuthContext;
  };
}

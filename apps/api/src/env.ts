import type { AuthContext } from "@rag/shared";

/**
 * Message shape enqueued on INGEST_QUEUE for async document ingestion. The
 * queue consumer (src/index.ts) starts an IngestWorkflow instance with this
 * as its params.
 */
export interface IngestMessage {
  tenantId: string;
  collectionId: string;
  documentId: string;
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
  /** Optional authorized party (azp) check. Empty to skip. */
  CLERK_AUTHORIZED_PARTY?: string;
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

  // --- Bindings (declared in wrangler.jsonc) -----------------------------
  /** Workers AI. */
  AI: Ai;
  /** Producer handle for the async ingestion queue. */
  INGEST_QUEUE: Queue<IngestMessage>;
  /** Durable ingestion workflow. */
  INGEST_WORKFLOW: Workflow;
  /** KV namespace for future API keys / rate limiting. */
  KV: KVNamespace;
  /** D1 database for collections/documents metadata (Drizzle schema). */
  DB: D1Database;
  /** R2 bucket holding the raw uploaded documents. */
  RAW_DOCS: R2Bucket;
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

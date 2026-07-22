import type { AuthContext } from "@rag/shared";

/**
 * Message shape enqueued on INGEST_QUEUE for async document ingestion.
 * TODO: expand once the ingestion pipeline is implemented.
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
  /** Pinecone credentials (unused until retrieval is implemented). */
  PINECONE_API_KEY: string;
  PINECONE_INDEX: string;

  // --- Bindings (declared in wrangler.jsonc) -----------------------------
  /** Workers AI. */
  AI: Ai;
  /** Producer handle for the async ingestion queue. */
  INGEST_QUEUE: Queue<IngestMessage>;
  /** Durable ingestion workflow. */
  INGEST_WORKFLOW: Workflow;
  /** KV namespace for future API keys / rate limiting. */
  KV: KVNamespace;
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

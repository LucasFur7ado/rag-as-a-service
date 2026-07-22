import { Hono } from "hono";
import type { AppBindings } from "../env";
import { requireAuth } from "../lib/auth";

/**
 * Query API (protected). Runs retrieval-augmented queries against a collection
 * (see QueryRequest / QueryResponse in @rag/shared).
 * TODO: implement retrieval + generation. Returns 501 Not Implemented for now.
 */
export const query = new Hono<AppBindings>();

query.use("*", requireAuth);

// TODO: POST "/" — embed query, retrieve from VectorStore, generate via LlmProvider.
query.all("*", (c) =>
  c.json({ error: "Not Implemented", resource: "query" }, 501),
);

import { Hono } from "hono";
import type { AppBindings } from "../env";
import { requireAuth } from "../lib/auth";

/**
 * Documents API (protected). Upload/list/delete documents and inspect ingest
 * status. Ingestion itself runs async via INGEST_QUEUE / INGEST_WORKFLOW.
 * TODO: implement. All handlers currently return 501 Not Implemented.
 */
export const documents = new Hono<AppBindings>();

documents.use("*", requireAuth);

// TODO: POST "/" upload+enqueue, GET "/" list, GET "/:id", DELETE "/:id".
documents.all("*", (c) =>
  c.json({ error: "Not Implemented", resource: "documents" }, 501),
);

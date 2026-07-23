import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { AppBindings, Env, IngestMessage } from "./env";
import { health } from "./routes/health";
import { me } from "./routes/me";
import { collections } from "./routes/collections";
import { documents } from "./routes/documents";
import { query } from "./routes/query";
import { apikeys } from "./routes/apikeys";

const app = new Hono<AppBindings>();

// CORS so the Next.js web app (a different origin) can call this worker with
// a Bearer token. Allowed origins come from the WEB_ORIGIN var (comma-separated
// for multiple environments). Preflight (OPTIONS) is handled by the middleware.
app.use("*", (c, next) => {
  const allowed = (c.env.WEB_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  })(c, next);
});

// --- Routes ---------------------------------------------------------------
app.route("/health", health); // public
app.route("/me", me); // protected

// Feature 1: collections + documents (protected, tenant-scoped).
app.route("/v1/collections", collections);
app.route("/v1/documents", documents);

// Feature stubs (protected, return 501 Not Implemented for now).
app.route("/query", query);
app.route("/apikeys", apikeys);

// --- Error handling -------------------------------------------------------
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

app.notFound((c) => c.json({ error: "Not Found" }, 404));

/**
 * Queue consumer for async ingestion: starts one durable IngestWorkflow
 * instance per message. The queue (rather than creating the instance inline
 * in the upload route) keeps uploads fast and gives instance creation its own
 * retries + dead-letter queue; the Workflow then owns per-step durability.
 */
async function queue(
  batch: MessageBatch<IngestMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      // Unique per attempt (ids can't be reused within the retention period);
      // the documentId prefix keeps instances traceable in the dashboard.
      await env.INGEST_WORKFLOW.create({
        id: `${message.body.documentId}-${Date.now()}`,
        params: message.body,
      });
      message.ack();
    } catch (err) {
      console.error(
        `Failed to start ingestion workflow for document ${message.body.documentId}:`,
        err,
      );
      message.retry({ delaySeconds: 30 });
    }
  }
}

export default {
  fetch: app.fetch,
  queue,
};

// Workflow class must be exported for the INGEST_WORKFLOW binding.
export { IngestWorkflow } from "./workflows/ingest";

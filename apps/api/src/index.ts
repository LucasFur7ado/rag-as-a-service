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

// CORS so the Next.js web app can call this worker with a Bearer token.
// TODO: tighten `origin` to the deployed web origin(s) for production.
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

// --- Routes ---------------------------------------------------------------
app.route("/health", health); // public
app.route("/me", me); // protected

// Feature stubs (protected, all return 501 Not Implemented for now).
app.route("/collections", collections);
app.route("/documents", documents);
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
 * Queue consumer for async ingestion (stub).
 * TODO: dispatch each message into INGEST_WORKFLOW.
 */
async function queue(
  batch: MessageBatch<IngestMessage>,
  _env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    console.log("INGEST_QUEUE received (not implemented):", message.body);
    // TODO: await env.INGEST_WORKFLOW.create({ params: message.body });
    message.ack();
  }
}

export default {
  fetch: app.fetch,
  queue,
};

// Workflow class must be exported for the INGEST_WORKFLOW binding.
export { IngestWorkflow } from "./workflows/ingest";

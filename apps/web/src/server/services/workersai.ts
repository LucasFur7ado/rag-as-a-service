import "server-only";

import { cloudflareAccountId, cloudflareApiToken } from "../env";
import { PermanentError } from "../lib/errors";

/**
 * Shared transport for the Workers AI REST API.
 *
 * This is the *model* only — the app calls `api.cloudflare.com` over plain
 * HTTPS from wherever it happens to be running. No Worker is deployed, no
 * `wrangler`, no `AI` binding, no Cloudflare runtime. (The previous incarnation
 * of this app ran on Workers and reached the same models through `env.AI.run`;
 * the REST endpoint is the equivalent for a non-Workers host.)
 *
 * Both AI calls in the app go through here — embeddings (services/embeddings.ts)
 * and answer generation (services/llm.ts) — so there is one account, one token,
 * and one error taxonomy for the whole pipeline.
 *
 * That taxonomy is what the ingestion retry logic depends on: a 4xx other than
 * 429 is deterministic — a bad token, an unknown model, a malformed request —
 * and becomes a `PermanentError` so ingestion fails fast instead of burning its
 * retry budget. 429 and 5xx stay plain `Error`s, i.e. "back off and retry".
 */

const API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Cloudflare's standard REST envelope. The model's own output is nested under
 * `result`; `success: false` can accompany a 200, so it is checked separately.
 */
interface CloudflareEnvelope<T> {
  result?: T;
  success?: boolean;
  errors?: { code?: number; message?: string }[];
}

/** POST to a model's run endpoint, mapping transport/HTTP failures. */
async function workersAiFetch(
  model: string,
  input: unknown,
  init?: { accept?: string },
): Promise<Response> {
  const url = `${API_BASE}/accounts/${cloudflareAccountId()}/ai/run/${model}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cloudflareApiToken()}`,
        "Content-Type": "application/json",
        ...(init?.accept ? { Accept: init.accept } : {}),
      },
      body: JSON.stringify(input),
    });
  } catch (err) {
    throw new Error(
      `Could not reach the Workers AI API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    const message = `Workers AI ${model} failed (${res.status}): ${detail || res.statusText}`;
    if (res.status !== 429 && res.status >= 400 && res.status < 500) {
      throw new PermanentError(message);
    }
    throw new Error(message);
  }
  return res;
}

/** Run a Workers AI model and return its (unwrapped) output. */
export async function workersAiRun<T>(model: string, input: unknown): Promise<T> {
  const res = await workersAiFetch(model, input);

  const body = (await res.json()) as CloudflareEnvelope<T>;
  if (body.success === false || body.result === undefined) {
    // A 200 carrying `success: false` is still a failure; surface the reasons.
    const detail =
      body.errors?.map((e) => e.message ?? String(e.code)).join("; ") ||
      "no result in response";
    throw new Error(`Workers AI ${model} returned an error: ${detail}`);
  }
  return body.result;
}

/**
 * Run a Workers AI model with `stream: true` and return the raw SSE body.
 *
 * Streaming responses are NOT wrapped in {@link CloudflareEnvelope} — the
 * endpoint switches to `text/event-stream` and emits bare `data:` lines — so
 * this deliberately returns the stream rather than a parsed result, and the
 * caller decodes the model-specific event shape.
 */
export async function workersAiStream(
  model: string,
  input: unknown,
): Promise<ReadableStream<Uint8Array>> {
  const res = await workersAiFetch(
    model,
    { ...(input as object), stream: true },
    { accept: "text/event-stream" },
  );
  if (!res.body) {
    // No body on a 200 is not something a retry fixes.
    throw new PermanentError(`Workers AI ${model} returned no stream`);
  }
  return res.body;
}

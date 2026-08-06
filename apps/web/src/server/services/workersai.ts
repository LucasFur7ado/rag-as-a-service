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
 * Mirrors services/gemini.ts, including the error taxonomy the ingestion retry
 * logic depends on: a 4xx other than 429 is deterministic — a bad token, an
 * unknown model, a malformed request — and becomes a `PermanentError` so
 * ingestion fails fast instead of burning its retry budget. 429 and 5xx stay
 * plain `Error`s, i.e. "back off and retry".
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

/** Run a Workers AI model and return its (unwrapped) output. */
export async function workersAiRun<T>(model: string, input: unknown): Promise<T> {
  const url = `${API_BASE}/accounts/${cloudflareAccountId()}/ai/run/${model}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cloudflareApiToken()}`,
        "Content-Type": "application/json",
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

import "server-only";

import { geminiApiKey } from "../env";
import { PermanentError } from "../lib/errors";

/**
 * Shared transport for the Google Generative Language REST API.
 *
 * We talk to the REST endpoints over plain `fetch` rather than pulling in
 * `@google/genai`: the surface we need is two endpoints wide, the SDK would be
 * bundled into every function that touches AI, and going direct keeps the
 * error taxonomy (`PermanentError` vs transient) in our hands, which the
 * ingestion retry logic depends on.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Call a Gemini endpoint and parse its JSON body.
 *
 * Failure mapping matches the rest of the pipeline: 4xx (except 429) is a
 * deterministic failure — a bad key, an unknown model, a malformed request —
 * and becomes a `PermanentError` so ingestion fails fast instead of burning
 * its retry budget. 429 and 5xx stay plain `Error`s: on the Gemini free tier a
 * 429 is the *expected* signal to back off and retry, not a dead end.
 */
export async function geminiFetch(
  path: string,
  body: unknown,
  init?: { signal?: AbortSignal; accept?: string },
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiApiKey(),
        "Content-Type": "application/json",
        ...(init?.accept ? { Accept: init.accept } : {}),
      },
      body: JSON.stringify(body),
      signal: init?.signal,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the Gemini API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    const message = `Gemini ${path.split("?")[0]} failed (${res.status}): ${detail || res.statusText}`;
    if (res.status !== 429 && res.status >= 400 && res.status < 500) {
      throw new PermanentError(message);
    }
    throw new Error(message);
  }
  return res;
}

/** Convenience wrapper for the JSON (non-streaming) endpoints. */
export async function geminiJson<T>(path: string, body: unknown): Promise<T> {
  const res = await geminiFetch(path, body);
  return (await res.json()) as T;
}

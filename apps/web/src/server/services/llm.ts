import "server-only";

import {
  GENERATION_MAX_TOKENS,
  GENERATION_MODEL,
  GENERATION_TEMPERATURE,
  GENERATION_THINKING_BUDGET,
} from "../config";
import { PermanentError } from "../lib/errors";
import { geminiFetch, geminiJson } from "./gemini";

/**
 * LLM provider seam.
 *
 * Concrete implementations (Gemini, Anthropic, OpenAI, ...) plug in here so
 * retrieval/route code depends only on this interface — generation can be
 * moved to another provider by swapping the class the route constructs.
 */

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  /** Model identifier, provider-specific. Defaults to the provider's model. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCompletion {
  text: string;
  model: string;
}

export interface LlmProvider {
  /** Model identifier used when the request doesn't specify one. */
  readonly defaultModel: string;
  /** Single-shot completion. */
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
  /** Streaming completion; yields text deltas as the model produces them. */
  stream(request: LlmCompletionRequest): AsyncIterable<string>;
}

interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}
interface GenerateContentResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Google Gemini text generation over the REST API (default model:
 * GENERATION_MODEL in src/server/config.ts).
 *
 * Gemini's request shape differs from the OpenAI-style `messages` array in two
 * ways this adapter absorbs: the system prompt is a separate top-level
 * `systemInstruction` rather than a message with `role: "system"`, and the
 * assistant role is spelled `model`.
 */
export class GeminiLlmProvider implements LlmProvider {
  readonly defaultModel: string = GENERATION_MODEL;

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const model = request.model ?? this.defaultModel;
    const body = await geminiJson<GenerateContentResponse>(
      `/models/${model}:generateContent`,
      buildRequestBody(request),
    );

    const text = extractText(body);
    if (text === null) {
      // A safety block or an empty candidate list will not fix itself on retry.
      const reason = body.promptFeedback?.blockReason;
      throw new PermanentError(
        `Gemini model ${model} returned no text response${reason ? ` (blocked: ${reason})` : ""}`,
      );
    }
    return { text, model };
  }

  async *stream(request: LlmCompletionRequest): AsyncIterable<string> {
    const model = request.model ?? this.defaultModel;
    // `alt=sse` switches the streaming endpoint from a chunked JSON array to
    // Server-Sent Events, which is incrementally parseable.
    const res = await geminiFetch(
      `/models/${model}:streamGenerateContent?alt=sse`,
      buildRequestBody(request),
      { accept: "text/event-stream" },
    );

    if (!res.body) {
      throw new PermanentError(`Gemini model ${model} returned no stream`);
    }
    yield* parseSseTextDeltas(res.body);
  }
}

/** Map the provider-neutral request onto Gemini's `generateContent` body. */
function buildRequestBody(request: LlmCompletionRequest) {
  const system = request.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const contents = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: {
      temperature: request.temperature ?? GENERATION_TEMPERATURE,
      maxOutputTokens: request.maxTokens ?? GENERATION_MAX_TOKENS,
      // Grounded extraction from supplied passages needs no chain of thought,
      // and thinking tokens cost quota and delay the first streamed token.
      thinkingConfig: { thinkingBudget: GENERATION_THINKING_BUDGET },
    },
  };
}

/** Concatenate every text part of the first candidate; null when there is none. */
function extractText(body: GenerateContentResponse): string | null {
  const parts = body.candidates?.[0]?.content?.parts;
  if (!parts) return null;
  const text = parts.map((p) => p.text ?? "").join("");
  return text || null;
}

/**
 * Decode a Gemini SSE byte stream into text deltas. Each `data:` line carries
 * one `GenerateContentResponse` chunk; events split across network chunks are
 * handled by buffering up to each newline.
 */
async function* parseSseTextDeltas(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineAt: number;
      while ((newlineAt = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineAt).trim();
        buffer = buffer.slice(newlineAt + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const text = extractText(JSON.parse(payload) as GenerateContentResponse);
          if (text) yield text;
        } catch {
          // Malformed keep-alive/partial line — skip rather than abort.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

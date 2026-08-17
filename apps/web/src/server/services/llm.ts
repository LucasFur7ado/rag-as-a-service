import "server-only";

import {
  GENERATION_MAX_TOKENS,
  GENERATION_MODEL,
  GENERATION_TEMPERATURE,
} from "../config";
import { PermanentError } from "../lib/errors";
import { workersAiRun, workersAiStream } from "./workersai";

/**
 * LLM provider seam.
 *
 * Concrete implementations (Workers AI, Anthropic, OpenAI, ...) plug in here so
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

/**
 * One chat-completion payload from Workers AI.
 *
 * The endpoint answers in two dialects at once: a flat `response` string and an
 * OpenAI-compatible `choices` array (`message.content` when buffered,
 * `delta.content` when streaming). `response` is the documented field and is
 * what we read; `choices` is the fallback, because a model served through the
 * OpenAI-compatible path can omit `response`.
 */
interface ChatCompletionPayload {
  response?: string;
  choices?: {
    message?: { content?: string };
    delta?: { content?: string };
  }[];
}

/**
 * Answer generation on Cloudflare Workers AI over the REST API (default model:
 * GENERATION_MODEL in src/server/config.ts).
 *
 * Same account, token, and transport as the embedding provider — the whole AI
 * pipeline now sits on one vendor and one quota (see services/workersai.ts).
 *
 * The adapter is thin because Workers AI already speaks the OpenAI-style
 * `messages` array this seam is modelled on: `system`/`user`/`assistant` map
 * across unchanged, with no separate system-instruction field to hoist.
 */
export class WorkersAiLlmProvider implements LlmProvider {
  readonly defaultModel: string = GENERATION_MODEL;

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const model = request.model ?? this.defaultModel;
    const body = await workersAiRun<ChatCompletionPayload>(
      model,
      buildRequestBody(request),
    );

    const text = extractText(body);
    if (text === null) {
      // An empty completion is deterministic for this prompt — a content filter
      // or an exhausted token budget — and will not fix itself on retry.
      throw new PermanentError(`Workers AI model ${model} returned no text response`);
    }
    return { text, model };
  }

  async *stream(request: LlmCompletionRequest): AsyncIterable<string> {
    const model = request.model ?? this.defaultModel;
    const body = await workersAiStream(model, buildRequestBody(request));
    yield* parseSseTextDeltas(body);
  }
}

/** Map the provider-neutral request onto the Workers AI text-generation body. */
function buildRequestBody(request: LlmCompletionRequest) {
  return {
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: request.temperature ?? GENERATION_TEMPERATURE,
    max_tokens: request.maxTokens ?? GENERATION_MAX_TOKENS,
  };
}

/** Pull the text out of a completion payload; null when there is none. */
function extractText(payload: ChatCompletionPayload): string | null {
  const choice = payload.choices?.[0];
  const text =
    payload.response ?? choice?.message?.content ?? choice?.delta?.content ?? "";
  return text || null;
}

/**
 * Decode a Workers AI SSE byte stream into text deltas. Each `data:` line
 * carries one {@link ChatCompletionPayload} chunk and the stream ends with the
 * `[DONE]` sentinel; events split across network chunks are handled by
 * buffering up to each newline.
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
          const text = extractText(JSON.parse(payload) as ChatCompletionPayload);
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

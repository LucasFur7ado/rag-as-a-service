import {
  GENERATION_MAX_TOKENS,
  GENERATION_MODEL,
  GENERATION_TEMPERATURE,
} from "../config";
import { PermanentError } from "../lib/errors";

/**
 * LLM provider seam.
 *
 * Concrete implementations (Workers AI, Anthropic, Gemini, ...) plug in here
 * so retrieval/route code depends only on this interface — generation can be
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
 * Workers AI text generation via the `AI` binding (default model:
 * GENERATION_MODEL in src/config.ts — an instruction-tuned open-weights
 * model on the Workers AI catalog).
 *
 * With `stream: true` Workers AI returns a `ReadableStream` of SSE bytes
 * (`data: {"response":"<delta>", ...}` lines, terminated by `data: [DONE]`);
 * `stream()` parses that into plain text deltas so callers never see SSE.
 */
export class WorkersAiLlmProvider implements LlmProvider {
  readonly defaultModel: string = GENERATION_MODEL;

  constructor(private readonly ai: Ai) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const model = request.model ?? this.defaultModel;
    const result = (await this.ai.run(model as keyof AiModels, {
      messages: request.messages,
      max_tokens: request.maxTokens ?? GENERATION_MAX_TOKENS,
      temperature: request.temperature ?? GENERATION_TEMPERATURE,
    })) as { response?: string };

    if (typeof result?.response !== "string") {
      throw new PermanentError(
        `Workers AI model ${model} returned no text response`,
      );
    }
    return { text: result.response, model };
  }

  async *stream(request: LlmCompletionRequest): AsyncIterable<string> {
    const model = request.model ?? this.defaultModel;
    const result = (await this.ai.run(model as keyof AiModels, {
      messages: request.messages,
      max_tokens: request.maxTokens ?? GENERATION_MAX_TOKENS,
      temperature: request.temperature ?? GENERATION_TEMPERATURE,
      stream: true,
    })) as unknown;

    if (!(result instanceof ReadableStream)) {
      // Defensive: some models ignore `stream` — degrade to one big delta.
      const text = (result as { response?: string })?.response;
      if (typeof text === "string") {
        yield text;
        return;
      }
      throw new PermanentError(
        `Workers AI model ${model} returned neither a stream nor text`,
      );
    }

    yield* parseSseTextDeltas(result);
  }
}

/**
 * Decode a Workers AI SSE byte stream into text deltas. Handles events split
 * across network chunks by buffering up to each newline.
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
        if (payload === "[DONE]") return;
        try {
          const parsed = JSON.parse(payload) as { response?: string };
          if (parsed.response) yield parsed.response;
        } catch {
          // Malformed keep-alive/partial line — skip rather than abort.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

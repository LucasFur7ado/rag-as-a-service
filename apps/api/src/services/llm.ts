/**
 * LLM provider seam.
 *
 * Concrete implementations (Workers AI, Anthropic, OpenAI, ...) plug in here.
 * Generation/streaming logic is intentionally out of scope for the scaffold.
 */

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  /** Model identifier, provider-specific. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCompletion {
  text: string;
  model: string;
}

export interface LlmProvider {
  /** Single-shot completion. */
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
  /** Streaming completion; yields text deltas. */
  stream(request: LlmCompletionRequest): AsyncIterable<string>;
}

/**
 * Placeholder implementation. Swap for a real provider when implementing the
 * query/generation feature.
 */
export class NotImplementedLlmProvider implements LlmProvider {
  // TODO: implement using Workers AI (env.AI) or an external LLM provider.
  complete(_request: LlmCompletionRequest): Promise<LlmCompletion> {
    throw new Error("LlmProvider.complete is not implemented");
  }

  // eslint-disable-next-line require-yield
  async *stream(_request: LlmCompletionRequest): AsyncIterable<string> {
    throw new Error("LlmProvider.stream is not implemented");
  }
}

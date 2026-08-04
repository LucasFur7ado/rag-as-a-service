/**
 * Prompts for the query pipeline, kept in one place so they are easy to
 * iterate on without touching pipeline code.
 */

/**
 * System prompt for grounded Q&A. Contract enforced downstream:
 * - the route validates emitted `[n]` markers against the real source list
 *   and flags any the model invented;
 * - the "not in the context" refusal keeps the model from answering from
 *   parametric memory when retrieval came up short.
 */
export const RAG_SYSTEM_PROMPT = `You are a precise question-answering assistant for a document knowledge base.

Rules:
1. Answer ONLY from the numbered context passages provided in the user message. Never use outside knowledge, even when you are confident.
2. Cite your sources: after each claim, add the marker(s) of the passage(s) that support it, exactly as given, e.g. [1] or [2][3]. Use only markers that exist in the context; never invent markers.
3. If the context does not contain the information needed to answer, reply exactly: "I could not find an answer to this in the provided documents." — optionally followed by one sentence about what related information IS present. Do not guess.
4. Be concise and factual. Use Markdown formatting (lists, bold) when it aids readability.
5. Answer in the language of the question.`;

/**
 * User-message template: context block first (passages labeled [1]..[n]),
 * question last — the two "high attention" ends of the window.
 */
export function buildUserPrompt(contextText: string, question: string): string {
  return `Context passages:

${contextText}

---

Question: ${question}`;
}

import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

/**
 * Token counting for the context budget (see CONTEXT_TOKEN_BUDGET in
 * src/config.ts).
 *
 * Uses a real BPE tokenizer (js-tiktoken, pure JS — Workers-compatible)
 * instead of a chars/4 guess, so the budget behaves consistently across
 * prose, code, and non-English text. The cl100k_base vocabulary is not
 * byte-identical to Llama's tokenizer, but both are byte-level BPEs with
 * similar-sized vocabularies, so counts track closely enough for budgeting
 * (they differ by a few percent, not multiples).
 */

// Built lazily: constructing the encoder walks the ~100k-entry rank table,
// which we don't want on the worker's critical startup path.
let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) encoder = new Tiktoken(cl100k_base);
  return encoder;
}

/** Number of BPE tokens in `text`. */
export function countTokens(text: string): number {
  return getEncoder().encode(text).length;
}

/**
 * Lexical overlap, used to keep the synthetic dataset honest.
 *
 * A generated question that reuses its passage's vocabulary verbatim ("What is
 * the recursive character chunking overlap constant?" against a passage
 * containing exactly those words) is retrieved perfectly by any dense model and
 * by plain keyword matching. A dataset full of them reports ~1.0 recall for
 * every configuration and can no longer tell a good retriever from a bad one —
 * the harness keeps working while measuring nothing.
 *
 * So `eval:gen` measures question-to-passage word overlap and rejects the
 * copies. Pure and deterministic, and unit-tested in lexical.test.ts.
 */

/**
 * Words that carry no retrieval signal. Kept short on purpose: this only needs
 * to stop question scaffolding ("what is the...") from counting as overlap with
 * the passage, not to be a linguistic stopword list.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
  "for", "from", "how", "in", "is", "it", "its", "of", "on", "or", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "to",
  "was", "were", "what", "when", "where", "which", "who", "why", "will",
  "with", "would", "you", "your",
]);

/**
 * Lowercased content words. Splits on non-letter/digit so punctuation and
 * markdown syntax do not create spurious tokens; drops stopwords and
 * single-character fragments.
 */
export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/** Jaccard similarity of the content-word SETS of two texts, in [0, 1]. */
export function wordJaccard(a: string, b: string): number {
  const setA = new Set(contentWords(a));
  const setB = new Set(contentWords(b));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Fraction of the QUESTION's words that appear in the passage.
 *
 * Directional, unlike Jaccard, and the more sensitive signal for this job: a
 * short question copied wholesale out of a long passage scores near 1 here
 * while its Jaccard stays low simply because the passage is longer.
 */
export function questionCoverage(question: string, passage: string): number {
  const questionWords = new Set(contentWords(question));
  if (questionWords.size === 0) return 0;
  const passageWords = new Set(contentWords(passage));

  let covered = 0;
  for (const word of questionWords) if (passageWords.has(word)) covered++;
  return covered / questionWords.size;
}

/** Whether `candidate` duplicates any accepted question. */
export function isNearDuplicate(
  candidate: string,
  accepted: readonly string[],
  threshold: number,
): boolean {
  return accepted.some((existing) => wordJaccard(candidate, existing) >= threshold);
}

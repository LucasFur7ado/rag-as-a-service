import { experiment, overlapFor } from "./_base";

/**
 * Chunk-size sweep, large end.
 *
 * Large chunks almost always raise recall — a bigger net catches more spans —
 * while diluting the context budget with unrelated text. Recall alone will
 * flatter this config; read it next to precision@k and remember that
 * CONTEXT_TOKEN_BUDGET fits fewer of these.
 */
export default experiment("Chunk-size sweep: 1200 chars, 15% overlap", {
  chunkSizeChars: 1200,
  chunkOverlapChars: overlapFor(1200),
});

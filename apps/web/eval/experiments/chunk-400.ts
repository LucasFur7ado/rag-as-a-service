import { experiment, overlapFor } from "./_base";

/**
 * Chunk-size sweep, small end. Overlap is held at the same 15% ratio so the
 * only variable is chunk size.
 *
 * Small chunks are more precise per slot but split a multi-sentence answer
 * across boundaries, where neither half retrieves well on its own. Watch
 * recall@5 against `chunk-1200`.
 */
export default experiment("Chunk-size sweep: 400 chars, 15% overlap", {
  chunkSizeChars: 400,
  chunkOverlapChars: overlapFor(400),
});

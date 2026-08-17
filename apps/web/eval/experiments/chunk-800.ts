import { experiment, overlapFor } from "./_base";

/** Chunk-size sweep, middle. Nearly the production size, for a sanity check. */
export default experiment("Chunk-size sweep: 800 chars, 15% overlap", {
  chunkSizeChars: 800,
  chunkOverlapChars: overlapFor(800),
});

import { experiment } from "./_base";

/**
 * Overlap sweep: none. Chunk size fixed at the production value.
 *
 * The cheapest configuration — no duplicated text, fewest vectors. If it scores
 * level with `overlap-30`, the product is paying for overlap it does not need.
 */
export default experiment("Overlap sweep: 0% (900 chars, no overlap)", {
  chunkOverlapChars: 0,
});

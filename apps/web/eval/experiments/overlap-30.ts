import { experiment, overlapFor } from "./_base";

/**
 * Overlap sweep: 30%, double what the product ships.
 *
 * More overlap means an answer straddling a boundary appears whole in at least
 * one chunk, at the cost of ~30% more vectors and more near-duplicate results
 * competing for the same top-k slots.
 */
export default experiment("Overlap sweep: 30% (900 chars)", {
  chunkOverlapChars: overlapFor(900, 0.3),
});

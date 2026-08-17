import { experiment } from "./_base";

/**
 * topK sensitivity, wide — MAX_TOP_K, the product's hard ceiling.
 *
 * Recall can only rise with k; precision can only fall. The question this
 * answers is where recall stops improving, which is where a re-ranker would
 * start earning its latency.
 */
export default experiment("topK sensitivity: 20 (MAX_TOP_K)", { topK: 20 });

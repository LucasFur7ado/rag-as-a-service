import { experiment } from "./_base";

/**
 * topK sensitivity, tight.
 *
 * Costs nothing extra to run: topK is a query-time setting, so this shares the
 * baseline's index and re-embeds nothing (see eval/lib/namespace.ts).
 */
export default experiment("topK sensitivity: 3", { topK: 3 });

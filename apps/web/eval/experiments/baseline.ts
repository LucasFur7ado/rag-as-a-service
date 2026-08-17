import { experiment } from "./_base";

/**
 * The configuration the product ships today, imported from
 * src/server/config.ts. Every other experiment is read as a delta against this
 * one, so it is the default `--baseline`.
 */
export default experiment("Production defaults (900 chars / 15% overlap / topK 8)");

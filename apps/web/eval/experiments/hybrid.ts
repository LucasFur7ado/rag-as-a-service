import { experiment } from "./_base";

/**
 * Dense vs hybrid (sparse + dense), everything else fixed.
 *
 * THIS EXPERIMENT CANNOT RUN TODAY and fails immediately with an explanation.
 * The Workers AI REST endpoint for `@cf/baai/bge-m3` returns dense vectors
 * only. The model does compute sparse/lexical weights, but they are not
 * exposed, so nothing sparse was stored at index time and there is nothing to
 * fuse at query time.
 *
 * It is committed anyway, because the blocker is a provider limitation rather
 * than a design gap: when sparse vectors become reachable, this file is the
 * ablation, unchanged. See the `TODO: hybrid search` markers in
 * src/server/services/embeddings.ts and retrieval.ts.
 */
export default experiment("Hybrid dense+sparse retrieval (blocked: no sparse vectors)", {
  mode: "hybrid",
});

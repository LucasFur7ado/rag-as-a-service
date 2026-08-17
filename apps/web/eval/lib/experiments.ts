import { existsSync, readdirSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EXPERIMENTS_DIR } from "../config";
import { resolveExperiment, type Experiment, type ResolvedExperiment } from "./types";

/**
 * Loading experiment definitions.
 *
 * Experiments are discovered from the directory, not registered in a list.
 * Adding an ablation is therefore exactly one action — drop `my-idea.ts` in
 * eval/experiments and run `pnpm eval:run -- --config my-idea` — which matters
 * because the whole value of the harness comes from running a lot of them.
 *
 * They are `.ts` rather than `.json` so a config can compute (share a base,
 * derive an overlap from a size) and so a typo is a typecheck failure rather
 * than a run that quietly measures the default.
 */

/** Every experiment name available, sorted. */
export function listExperiments(): string[] {
  if (!existsSync(EXPERIMENTS_DIR)) return [];
  return readdirSync(EXPERIMENTS_DIR)
    .filter(
      (file) =>
        extname(file) === ".ts" &&
        !file.endsWith(".test.ts") &&
        // `_`-prefixed files are shared helpers, not runnable experiments.
        !file.startsWith("_"),
    )
    .map((file) => basename(file, ".ts"))
    .sort();
}

/** Load one experiment by name, validating the parts that must be present. */
export async function loadExperiment(name: string): Promise<ResolvedExperiment> {
  const path = resolve(EXPERIMENTS_DIR, `${name}.ts`);
  if (!existsSync(path)) {
    const available = listExperiments();
    throw new Error(
      `No experiment named "${name}" in eval/experiments.` +
        (available.length > 0 ? ` Available: ${available.join(", ")}` : ""),
    );
  }

  const loaded = (await import(pathToFileURL(path).href)) as { default?: Experiment };
  const experiment = loaded.default;
  if (!experiment) {
    throw new Error(`eval/experiments/${name}.ts must have a default export (the Experiment).`);
  }

  const resolved = resolveExperiment(name, experiment);
  validate(resolved);
  return resolved;
}

function validate(experiment: ResolvedExperiment): void {
  const { chunking, retrieval, name } = experiment;

  if (chunking.sizeChars <= 0) {
    throw new Error(`${name}: chunking.sizeChars must be positive.`);
  }
  if (chunking.overlapChars < 0 || chunking.overlapChars >= chunking.sizeChars) {
    throw new Error(
      `${name}: chunking.overlapChars (${chunking.overlapChars}) must be >= 0 and < sizeChars ` +
        `(${chunking.sizeChars}) — an overlap at or above the chunk size never advances.`,
    );
  }
  if (retrieval.topK <= 0) throw new Error(`${name}: retrieval.topK must be positive.`);

  if (retrieval.mode === "hybrid") {
    // Fail here rather than silently running dense and labelling it hybrid.
    // See eval/README.md → "The hybrid ablation cannot run yet".
    throw new Error(
      `${name}: retrieval.mode "hybrid" is not implemented and cannot be simulated honestly.\n` +
        `  The Workers AI REST endpoint for @cf/baai/bge-m3 returns dense vectors only. The model\n` +
        `  computes sparse/lexical weights, but they are not exposed, so nothing sparse was stored\n` +
        `  at index time and there is nothing to fuse at query time.\n` +
        `  To run this ablation, first make sparse vectors available (see the "TODO: hybrid search"\n` +
        `  markers in src/server/services/embeddings.ts and retrieval.ts), store them in\n` +
        `  eval/lib/indexer.ts, and issue a sparse-dense query here.`,
    );
  }
}

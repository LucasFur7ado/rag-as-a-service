import { EMBEDDING_MODEL } from "../../src/server/config";
import { WorkersAiEmbeddingProvider } from "../../src/server/services/embeddings";
import { PineconeVectorStore } from "../../src/server/services/vectorstore";
import { CORPUS_DIR } from "../config";
import { loadEnvFiles, requireCredentials } from "../lib/bootstrap";
import { confirmBudget, estimateNeurons, tokensIn } from "../lib/budget";
import { EmbeddingCache } from "../lib/cache";
import { fail, parseArgs } from "../lib/cli";
import { loadCorpus } from "../lib/corpus";
import { loadDataset, validateAgainstCorpus } from "../lib/dataset";
import { CachedEmbedder } from "../lib/embedder";
import { listExperiments, loadExperiment } from "../lib/experiments";
import { buildChunks } from "../lib/indexer";
import { fingerprintCorpus } from "../lib/namespace";
import { printSummary, writeResults } from "../lib/report";
import { runExperiment, type ExperimentRun } from "../lib/runner";
import type { ResolvedExperiment } from "../lib/types";

/**
 * `pnpm eval:run -- --config <name> [--config <name> ...]`
 *
 * Runs one or more experiments against a golden dataset and writes a report.
 * Real Workers AI calls, a real Pinecone index, real quota — never part of
 * `pnpm test` or CI.
 *
 * Flags:
 *   --config <name>     Experiment to run. Repeatable. Required.
 *   --baseline <name>   Which config the comparison deltas are against.
 *                       Defaults to the first --config.
 *   --dataset <name>    Override the dataset the experiments name.
 *   --force             Re-index even when the namespace already exists.
 *   --yes               Skip the budget confirmation prompt.
 *   --list              Print the available experiments and exit.
 */

async function main(): Promise<void> {
  loadEnvFiles();
  const args = parseArgs();

  if (args.flag("list")) {
    const names = listExperiments();
    console.log(names.length ? names.map((n) => `  ${n}`).join("\n") : "  (no experiments)");
    return;
  }

  const names = args.list("config");
  if (names.length === 0) {
    throw new Error(
      `No experiment selected. Use --config <name>; available: ${listExperiments().join(", ") || "(none)"}`,
    );
  }

  requireCredentials({ ai: true, vectors: true });

  const experiments: ResolvedExperiment[] = [];
  for (const name of names) experiments.push(await loadExperiment(name));

  const datasetOverride = args.value("dataset");
  const datasetNames = new Set(experiments.map((e) => datasetOverride ?? e.dataset));
  if (datasetNames.size > 1) {
    throw new Error(
      `Experiments name different datasets (${[...datasetNames].join(", ")}). A comparison is only ` +
        `meaningful on one dataset — run them separately, or pass --dataset to pin one.`,
    );
  }
  const datasetName = [...datasetNames][0];

  const models = new Set(experiments.map((e) => e.embeddingModel));
  if (models.size > 1) {
    // Vectors from different models are not comparable, and this index holds
    // one dimension. Catch it here rather than as a Pinecone dimension error.
    throw new Error(
      `Experiments use different embedding models (${[...models].join(", ")}). Only one model can be ` +
        `evaluated per run — vectors from different models do not share a space.`,
    );
  }

  console.log(`\n  Dataset:     ${datasetName}`);
  console.log(`  Experiments: ${names.join(", ")}`);

  // --- Load and validate inputs before spending anything --------------------
  const documents = await loadCorpus(CORPUS_DIR);
  const corpusFingerprint = fingerprintCorpus(documents);
  const dataset = loadDataset(datasetName);

  console.log(
    `  Corpus:      ${documents.length} documents, ` +
      `${documents.reduce((sum, d) => sum + d.totalChars, 0).toLocaleString()} chars (${corpusFingerprint})`,
  );
  console.log(`  Questions:   ${dataset.items.length}\n`);

  const problems = validateAgainstCorpus(dataset.items, documents);
  if (problems.length > 0) {
    // These produce questions no chunk can satisfy, which would read as a
    // retrieval regression. Refuse rather than quietly report bad numbers.
    throw new Error(
      `The dataset does not line up with the corpus:\n${problems.map((p) => `  - ${p}`).join("\n")}\n\n` +
        `Golden spans index the extracted page text. If a corpus file changed, the spans must be re-derived.`,
    );
  }

  // --- Price the run --------------------------------------------------------
  const model = [...models][0];
  const cache = new EmbeddingCache();
  const embedder = new CachedEmbedder(new WorkersAiEmbeddingProvider(), model, cache);

  const uncached = new Set<string>();
  for (const experiment of experiments) {
    for (const chunk of buildChunks(documents, experiment.chunking)) {
      if (!cache.has(chunk.text, model)) uncached.add(chunk.text);
    }
  }
  for (const item of dataset.items) {
    if (!cache.has(item.question, model)) uncached.add(item.question);
  }

  await confirmBudget([estimateNeurons(model, tokensIn([...uncached]))], {
    yes: args.flag("yes"),
  });

  // --- Run ------------------------------------------------------------------
  const startedAt = new Date();
  const runs: ExperimentRun[] = [];
  const force = args.flag("force");

  for (const experiment of experiments) {
    console.log(`\n  ▸ ${experiment.name} — ${experiment.description}`);
    runs.push(
      await runExperiment({
        experiment,
        documents,
        corpusFingerprint,
        items: dataset.items,
        store: new PineconeVectorStore(),
        embedder,
        force,
        onProgress: (message) => console.log(`    ${message}`),
      }),
    );
  }

  const baseline = args.value("baseline", names[0])!;
  const dir = writeResults({
    runs,
    documents,
    dataset: { name: datasetName, manifest: dataset.manifest, itemCount: dataset.items.length },
    baseline,
    startedAt,
  });

  printSummary(runs, baseline, dir);
  console.log(
    `  Embedding spend: ${embedder.stats.embedded} embedded, ${embedder.stats.cacheHits} from cache, ` +
      `${embedder.stats.requests} requests, ~${Math.ceil(estimateNeurons(model, embedder.stats.tokens).neurons).toLocaleString()} neurons\n`,
  );

  if (model !== EMBEDDING_MODEL) {
    console.warn(
      `  Note: this run used ${model}, but the app ingests with ${EMBEDDING_MODEL}. ` +
        `The numbers describe a model the product does not currently run.\n`,
    );
  }
}

main().catch(fail);

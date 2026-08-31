import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHUNK_OVERLAP_CHARS,
  CHUNK_SIZE_CHARS,
  EMBEDDING_MODEL,
} from "../../src/server/config";
import { WorkersAiEmbeddingProvider } from "../../src/server/services/embeddings";
import { PineconeVectorStore } from "../../src/server/services/vectorstore";
import {
  BEIR_NEURON_BUDGET_PROMPT_THRESHOLD,
  BEIR_SEARCH_ROOTS,
  DEFAULT_BEIR_CHUNK_DEPTH,
  DEFAULT_BEIR_DATASET,
  DEFAULT_BEIR_SPLIT,
  BEIR_DEFAULT_SEED,
  FREE_NEURONS_PER_DAY,
} from "../config";
import { loadEnvFiles, requireCredentials } from "../lib/bootstrap";
import { confirmBudget, estimateNeurons, tokensIn } from "../lib/budget";
import {
  BEIR_SPLITS,
  availableSplits,
  loadBeirDataset,
  resolveDatasetDir,
  type BeirSplit,
} from "../lib/beir/dataset";
import { printBeirSummary, writeBeirResults } from "../lib/beir/report";
import { beirNamespace, runBeir } from "../lib/beir/runner";
import { EmbeddingCache } from "../lib/cache";
import { fail, parseArgs } from "../lib/cli";
import { CachedEmbedder } from "../lib/embedder";
import { buildChunks } from "../lib/indexer";
import type { ChunkingConfig } from "../lib/types";

/**
 * `pnpm eval:beir [-- --dataset nfcorpus] [--queries N] [--max-docs N]`
 *
 * Scores retrieval against a public BEIR benchmark, whose ground truth is whole
 * documents — the complement to `pnpm eval:run`, whose ground truth is
 * character spans in a small committed corpus. The two answer different
 * questions and neither replaces the other:
 *
 *   eval:run   Does OUR retrieval find the passage that answers the question?
 *              Small, hand-written, span-anchored, valid across chunk sizes.
 *   eval:beir  How does this retrieval stack rank against a public benchmark
 *              on 3,633 documents nobody here wrote?
 *
 * Real Workers AI calls, a real Pinecone index, real quota — never part of
 * `pnpm test` or CI. Only the pure judging and parsing logic is unit-tested.
 *
 * Flags:
 *   --dataset <name>     BEIR dataset name. Default: nfcorpus.
 *   --data <path>        Explicit dataset directory (overrides the search path).
 *   --split <name>       train | dev | test. Default: test.
 *   --queries <n>        Score a seeded sample of N queries instead of all.
 *   --max-docs <n>       Index at most N documents. Every judged document is
 *                        kept; the rest of the budget is distractors. CHEAPER,
 *                        but the result stops being comparable to published
 *                        numbers — see the caveats it prints.
 *   --seed <n>           Sampling seed. Default: 1.
 *   --depth <n>          Chunks retrieved per query before folding to documents.
 *                        Costs no embedding quota. Default: 250.
 *   --chunk-size <n>     Chunk size in characters. Default: the product's.
 *   --chunk-overlap <n>  Chunk overlap in characters. Default: the product's.
 *   --dry-run            Price the run and print what it would index, then stop.
 *   --force              Re-index even when the namespace already exists.
 *   --yes                Skip the budget confirmation prompt.
 *   --list               Show the datasets found on the search path and exit.
 */

async function main(): Promise<void> {
  loadEnvFiles();
  const args = parseArgs();

  if (args.flag("list")) {
    listDatasets();
    return;
  }

  const name = args.value("dataset", DEFAULT_BEIR_DATASET)!;
  const split = parseSplit(args.value("split", DEFAULT_BEIR_SPLIT)!);
  const seed = parseCount(args.value("seed"), "--seed") ?? BEIR_DEFAULT_SEED;
  const maxQueries = parseCount(args.value("queries"), "--queries");
  const maxDocuments = parseCount(args.value("max-docs"), "--max-docs");
  const chunkDepth = parseCount(args.value("depth"), "--depth") ?? DEFAULT_BEIR_CHUNK_DEPTH;

  const chunking: ChunkingConfig = {
    strategy: "recursive",
    sizeChars: parseCount(args.value("chunk-size"), "--chunk-size") ?? CHUNK_SIZE_CHARS,
    // Minimum 0, not 1: no overlap is a real configuration — it is what the
    // committed `overlap-0` experiment measures — and rejecting it would make
    // the ablation unrunnable here.
    overlapChars:
      parseCount(args.value("chunk-overlap"), "--chunk-overlap", 0) ?? CHUNK_OVERLAP_CHARS,
  };
  if (chunking.overlapChars >= chunking.sizeChars) {
    throw new Error(
      `--chunk-overlap (${chunking.overlapChars}) must be smaller than --chunk-size ` +
        `(${chunking.sizeChars}) — an overlap at or above the chunk size never advances.`,
    );
  }

  // --- Load and validate before spending anything ---------------------------
  const dir = resolveDatasetDir(name, args.value("data"));
  const dataset = loadBeirDataset({ name, split, dir, maxQueries, maxDocuments, seed });
  const { sampling } = dataset;

  console.log(`\n  Dataset:     ${name} (${split}) — ${dir}`);
  console.log(
    `  Corpus:      ${sampling.documentsUsed.toLocaleString()} of ` +
      `${sampling.documentsAvailable.toLocaleString()} documents, ` +
      `${dataset.totalChars.toLocaleString()} chars (${dataset.fingerprint})`,
  );
  console.log(
    `  Queries:     ${sampling.queriesUsed} of ${sampling.queriesAvailable} judged` +
      (sampling.queriesUsed < sampling.queriesAvailable ? ` (seed ${seed})` : ""),
  );

  const relevantTotal = [...dataset.qrels.values()].reduce((sum, judged) => sum + judged.size, 0);
  console.log(
    `  Judgements:  ${relevantTotal.toLocaleString()} relevant pairs, ` +
      `${(relevantTotal / Math.max(1, sampling.queriesUsed)).toFixed(1)} per query on average`,
  );
  if (sampling.danglingQrels > 0) {
    console.log(
      `               ${sampling.danglingQrels.toLocaleString()} judgement(s) named a document ` +
        `absent from corpus.jsonl and were dropped`,
    );
  }

  const chunks = buildChunks(dataset.documents, chunking);
  console.log(
    `  Chunking:    ${chunking.sizeChars} chars / ${chunking.overlapChars} overlap ` +
      `→ ${chunks.length.toLocaleString()} chunks`,
  );
  console.log(`  Retrieval:   ${chunkDepth} chunks per query, folded to a document ranking\n`);

  if (sampling.pooledCorpus) {
    console.warn(
      `  ! The corpus was cut to ${sampling.documentsUsed.toLocaleString()} documents. Ground truth\n` +
        `    is intact (every judged document was kept), but a smaller haystack inflates every\n` +
        `    metric. This run will NOT be comparable to published BEIR numbers.\n`,
    );
  }

  // --- Price the run --------------------------------------------------------
  const cache = new EmbeddingCache();
  const uncached = new Set<string>();
  for (const chunk of chunks) {
    if (!cache.has(chunk.text, EMBEDDING_MODEL)) uncached.add(chunk.text);
  }
  for (const query of dataset.queries) {
    if (!cache.has(query.text, EMBEDDING_MODEL)) uncached.add(query.text);
  }

  const estimate = estimateNeurons(EMBEDDING_MODEL, tokensIn([...uncached]));

  if (args.flag("dry-run")) {
    const namespace = beirNamespace(dataset, chunking, EMBEDDING_MODEL);
    console.log(`  Namespace:   ${namespace}`);
    console.log(
      `  To embed:    ${uncached.size.toLocaleString()} of ` +
        `${(chunks.length + dataset.queries.length).toLocaleString()} texts are not cached\n`,
    );
    console.log(
      `  Estimated:   ~${Math.ceil(estimate.neurons).toLocaleString()} neurons — ` +
        `${((estimate.neurons / FREE_NEURONS_PER_DAY) * 100).toFixed(1)}% of the ` +
        `${FREE_NEURONS_PER_DAY.toLocaleString()}/day free allowance (~$${estimate.usd.toFixed(4)})\n`,
    );
    console.log("  --dry-run: nothing embedded, nothing indexed.\n");
    return;
  }

  requireCredentials({ ai: true, vectors: true });

  await confirmBudget([estimate], {
    yes: args.flag("yes"),
    // Far below the span harness's threshold: a BEIR corpus is three orders of
    // magnitude larger than the committed one, and indexing one in full is a
    // material slice of the day's allowance. That should be approved, not
    // discovered afterwards.
    threshold: BEIR_NEURON_BUDGET_PROMPT_THRESHOLD,
  });

  // --- Run ------------------------------------------------------------------
  const startedAt = new Date();
  const embedder = new CachedEmbedder(new WorkersAiEmbeddingProvider(), EMBEDDING_MODEL, cache);

  const run = await runBeir({
    dataset,
    chunking,
    retrieval: { chunkDepth },
    embeddingModel: EMBEDDING_MODEL,
    store: new PineconeVectorStore(),
    embedder,
    force: args.flag("force"),
    onProgress: (message) => console.log(`    ${message}`),
  });

  const resultsDir = writeBeirResults({ run, startedAt });
  printBeirSummary(run, resultsDir);
  console.log(
    `  Embedding spend: ${embedder.stats.embedded.toLocaleString()} embedded, ` +
      `${embedder.stats.cacheHits.toLocaleString()} from cache, ${embedder.stats.requests} requests, ` +
      `~${Math.ceil(estimateNeurons(EMBEDDING_MODEL, embedder.stats.tokens).neurons).toLocaleString()} neurons\n`,
  );
}

function parseSplit(value: string): BeirSplit {
  if ((BEIR_SPLITS as readonly string[]).includes(value)) return value as BeirSplit;
  throw new Error(`--split must be one of ${BEIR_SPLITS.join(", ")}; got "${value}".`);
}

/** Parse an integer flag, rejecting the typos that would silently do nothing. */
function parseCount(
  value: string | undefined,
  flag: string,
  min = 1,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(
      `${flag} must be an integer >= ${min}; got "${value}".`,
    );
  }
  return parsed;
}

/** What is on the search path, so a missing dataset is diagnosable. */
function listDatasets(): void {
  console.log("");
  let found = 0;
  for (const root of BEIR_SEARCH_ROOTS) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = resolve(root, entry.name);
      if (!existsSync(resolve(dir, "corpus.jsonl"))) continue;
      const splits = availableSplits(dir);
      console.log(`  ${entry.name}  (${splits.join(", ") || "no qrels"})  ${dir}`);
      found++;
    }
  }
  if (found === 0) {
    console.log("  No BEIR datasets found. Searched:");
    for (const root of BEIR_SEARCH_ROOTS) console.log(`    ${root}`);
    console.log("\n  Point at one with --data <path>, or see eval/README.md.");
  }
  console.log("");
}

main().catch(fail);

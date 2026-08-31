/**
 * Evaluation-harness settings.
 *
 * Deliberately separate from src/server/config.ts: that file tunes the running
 * product, this one tunes how the product is *measured*. Nothing in the app
 * imports this, and nothing here changes app behaviour.
 *
 * Like src/server/config.ts, this module reads no environment and imports no
 * `server-only` module, so it stays importable from plain tsx scripts and from
 * the deterministic vitest suite.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// --- Layout -----------------------------------------------------------------

/** Root of the harness (this directory). */
export const EVAL_ROOT = here;
/** Committed source documents the harness indexes. */
export const CORPUS_DIR = resolve(here, "corpus");
/** Committed golden datasets (`<name>.jsonl` + `<name>.meta.json`). */
export const DATASETS_DIR = resolve(here, "datasets");
/** Committed experiment definitions (`<name>.ts`). */
export const EXPERIMENTS_DIR = resolve(here, "experiments");
/** Run output. Git-ignored — copy a `report.md` out if you want to keep it. */
export const RESULTS_DIR = resolve(here, "results");
/** On-disk embedding cache. Git-ignored; safe to delete at any time. */
export const CACHE_DIR = resolve(here, ".cache");

// --- Namespacing ------------------------------------------------------------

/**
 * Prefix on every Pinecone namespace the harness writes.
 *
 * This is the isolation boundary between evaluation and real tenant data.
 * Tenant namespaces are built by `vectorNamespace()` as `t_{tenant}__c_{coll}`
 * and can never collide with this prefix; `eval:clean` refuses to delete a
 * namespace that does not start with it.
 */
export const EVAL_NAMESPACE_PREFIX = "__eval__";

// --- Reporting --------------------------------------------------------------

/** Cutoffs every metric is reported at. */
export const REPORT_K_VALUES = [1, 3, 5, 10] as const;

/**
 * How many of the worst queries to write to `failures.jsonl`.
 *
 * "Worst" is ranked by first-relevant rank descending (complete misses first),
 * so the head of the file is always the queries retrieval failed hardest on.
 */
export const MAX_FAILURES_REPORTED = 50;

/** Retrieved chunks recorded per failure, for diagnosing *why* it failed. */
export const FAILURE_CONTEXT_CHUNKS = 5;

/** Characters of chunk text kept per failure record. Keeps the file readable. */
export const FAILURE_SNIPPET_CHARS = 300;

// --- Relevance judgement ----------------------------------------------------

/**
 * How a retrieved chunk is judged relevant to a golden item.
 *
 * Ground truth is a span of the ORIGINAL document text, never a chunk id, so
 * the same dataset stays valid when chunk boundaries move. A chunk is relevant
 * when its own source span overlaps the golden span by enough.
 *
 * The default is the disjunction the README documents: a chunk counts if it
 * overlaps the golden span at all (>= MIN_OVERLAP_CHARS) OR if it covers at
 * least half of it. The first clause is generous on purpose — a chunk holding
 * the tail of the answer is still a useful retrieval — and the second is what
 * you tighten (`mode: "all"`, or raise the coverage) when you want to measure
 * whether a chunk contains a *complete* answer rather than a fragment of one.
 */
export interface OverlapRule {
  /**
   * Minimum overlapping characters. 1 means "any overlap at all". A token is
   * ~4 characters, so raise this to ~4 to approximate "at least one token".
   */
  minOverlapChars: number;
  /** Minimum fraction of the GOLDEN span the chunk must cover, in [0, 1]. */
  minGoldenCoverage: number;
  /** `any`: either condition suffices. `all`: both must hold. */
  mode: "any" | "all";
}

export const DEFAULT_OVERLAP_RULE: OverlapRule = {
  minOverlapChars: 1,
  minGoldenCoverage: 0.5,
  mode: "any",
};

// --- Quota and cost ---------------------------------------------------------

/**
 * Workers AI neuron prices, per 1M tokens, for the models the harness calls.
 * Source: Cloudflare's Workers AI pricing page. These mirror the USD rates in
 * src/server/config.ts (MODEL_COSTS) but in the unit the free tier is
 * denominated in, because neurons — not dollars — are what runs out.
 */
export const NEURONS_PER_MILLION_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  "@cf/baai/bge-m3": { input: 1_075, output: 0 },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 26_668, output: 204_805 },
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": { input: 4_119, output: 34_868 },
};

/** Fallback rates for a model not listed above. Deliberately pessimistic. */
export const DEFAULT_NEURON_RATE = { input: 30_000, output: 210_000 };

/** The Workers AI free allowance, for framing an estimate against a budget. */
export const FREE_NEURONS_PER_DAY = 10_000;

/**
 * Estimated neuron spend above which a run stops and asks for confirmation.
 *
 * Set to a fifth of the daily allowance: high enough that iterating on a small
 * dataset never prompts, low enough that a mistakenly large corpus cannot burn
 * the day's quota before anyone notices. `--yes` skips the prompt.
 */
export const NEURON_BUDGET_PROMPT_THRESHOLD = 2_000;

// --- Provider pacing --------------------------------------------------------

/**
 * Delay between embedding requests during evaluation, in ms.
 *
 * Non-zero here where ingestion uses 0 (EMBED_BATCH_DELAY_MS): a run fires its
 * batches back to back with no user waiting, so a little spacing costs nothing
 * and keeps a large corpus clear of the 3,000 requests/minute ceiling.
 */
export const EMBED_REQUEST_DELAY_MS = 50;

/** Retries for a transient (429/5xx/network) provider failure during a run. */
export const EVAL_MAX_RETRIES = 5;

/** Base backoff between those retries, in ms; doubles each attempt. */
export const EVAL_RETRY_BASE_MS = 1_500;

// --- Synthetic dataset generation -------------------------------------------

/**
 * Reject a generated question whose words overlap its source passage by more
 * than this fraction (Jaccard over lowercased content words).
 *
 * This is the single most important quality control in `eval:gen`. A question
 * that reuses the passage's vocabulary verbatim is trivially retrievable by any
 * embedding model, so a dataset full of them reports near-perfect recall for
 * every configuration and can no longer distinguish good retrieval from bad —
 * the harness would look like it works while measuring nothing.
 */
export const MAX_QUESTION_PASSAGE_JACCARD = 0.6;

/** Reject a generated question too similar to one already accepted. */
export const MAX_QUESTION_QUESTION_JACCARD = 0.7;

/** Passage length sampled for question generation, in characters. */
export const GEN_PASSAGE_CHARS = 700;

/** Generation temperature. Higher than the product's 0.1: variety is the point. */
export const GEN_TEMPERATURE = 0.7;

// --- BEIR benchmark datasets ------------------------------------------------

/**
 * The second kind of ground truth this harness understands.
 *
 * Everything above describes the *custom* golden set, whose answer key is a
 * span of a source document. BEIR datasets (`eval:beir`) are the opposite
 * shape: a public benchmark whose answer key names whole documents, with a
 * graded relevance per (query, document) pair and no offsets anywhere. The two
 * cannot share a judging rule, so they do not share one — see
 * `lib/beir/judge.ts` for what replaces span overlap.
 *
 * What they DO share is everything that costs money or can corrupt data: the
 * chunker, the embedding cache, the budget gate, the `__eval__:` namespace
 * prefix, and the metric math in `lib/metrics.ts`.
 */

/**
 * Directories searched for a BEIR dataset, relative to this file, in order.
 * `--data <path>` overrides them all, and `BEIR_DATA_DIR` is checked first.
 *
 * The repository root is included because that is where an unpacked BEIR
 * download naturally lands (`<repo>/nfcorpus/`). The data itself is NOT
 * committed: it is ~9 MB of third-party corpus that is versioned, published,
 * and re-downloadable, so reproducibility comes from naming it and fingerprinting
 * its contents rather than from vendoring it.
 */
export const BEIR_SEARCH_ROOTS = [
  resolve(here, "beir", "data"),
  resolve(here, "..", "..", ".."),
] as const;

/** Where a missing dataset can be fetched from, printed in the error. */
export const BEIR_DOWNLOAD_URL_TEMPLATE =
  "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/{name}.zip";

/** Default BEIR dataset, and the one this repo was set up against. */
export const DEFAULT_BEIR_DATASET = "nfcorpus";

/** Default qrels split. `test` is what published BEIR numbers are measured on. */
export const DEFAULT_BEIR_SPLIT = "test";

/**
 * Cutoffs the BEIR report is measured at.
 *
 * Wider than REPORT_K_VALUES because BEIR's conventions are: nDCG@10 is the
 * headline, Recall@100 and MAP@100 are the companions. NFCorpus averages ~38
 * relevant documents per test query (median 16, max 475), so recall at a small
 * k is bounded far below 1 by the dataset itself and says more about the answer
 * key than about retrieval.
 */
export const BEIR_K_VALUES = [1, 3, 5, 10, 20, 100] as const;

/**
 * Chunks fetched per query before folding to a document ranking.
 *
 * This is NOT the product's topK. BEIR scores a ranking of *documents*, and a
 * document ranking of depth 100 needs more than 100 chunks to exist, because
 * several retrieved chunks routinely come from the same document. NFCorpus
 * documents average ~1.6k characters — about two chunks each at the production
 * chunk size — so 250 chunks yields a document ranking comfortably past the
 * largest cutoff in BEIR_K_VALUES.
 *
 * Depth costs no embedding quota: it is a query-time parameter, and folding is
 * order-preserving, so one run at this depth reports the correct number at every
 * cutoff rather than needing a run per cutoff.
 */
export const DEFAULT_BEIR_CHUNK_DEPTH = 250;

/**
 * Estimated neurons above which a BEIR run stops and asks for confirmation.
 *
 * Much lower than NEURON_BUDGET_PROMPT_THRESHOLD, and deliberately so. A BEIR
 * corpus is three orders of magnitude larger than the committed one: indexing
 * NFCorpus in full costs a material slice of the 10,000/day allowance, and a
 * chunk-size sweep over it would spend the whole day's quota. That should be a
 * decision someone makes on purpose, not a number they read afterwards.
 */
export const BEIR_NEURON_BUDGET_PROMPT_THRESHOLD = 500;

/** Seed for query/document sampling. Fixed so a sampled run is reproducible. */
export const BEIR_DEFAULT_SEED = 1;

/**
 * How long to wait for a freshly indexed BEIR namespace to become queryable.
 *
 * Five minutes rather than the one the committed corpus gets: this is tens of
 * thousands of vectors, and querying a partially visible index does not fail —
 * it silently reports *better* metrics, because a missing chunk is one fewer
 * competitor for the top slots.
 */
export const BEIR_VISIBILITY_TIMEOUT_MS = 300_000;

/** Worst queries written to `failures.jsonl` for a BEIR run. */
export const MAX_BEIR_FAILURES_REPORTED = 25;

/** Documents recorded per failing query, retrieved and missed alike. */
export const BEIR_FAILURE_CONTEXT_DOCS = 10;

/**
 * Published nDCG@10 reference points, for reading a run's headline number
 * against something.
 *
 * Only quoted for a run that is actually comparable — full corpus, full query
 * set, standard split — because a sampled corpus is a smaller haystack and
 * scores higher for reasons that have nothing to do with retrieval quality.
 *
 * These are lexical-baseline numbers from the BEIR paper (Thakur et al., 2021,
 * NeurIPS Datasets & Benchmarks), not measurements taken here. For current
 * dense-model numbers see the MTEB retrieval leaderboard, which tracks the same
 * splits: https://huggingface.co/spaces/mteb/leaderboard
 */
export const BEIR_REFERENCE_NDCG10: Record<string, { system: string; ndcg10: number; source: string }[]> = {
  nfcorpus: [
    { system: "BM25 (lexical baseline)", ndcg10: 0.325, source: "BEIR paper, Table 2" },
  ],
};

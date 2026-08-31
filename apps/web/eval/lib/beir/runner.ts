import { createHash } from "node:crypto";
import {
  BEIR_K_VALUES,
  BEIR_VISIBILITY_TIMEOUT_MS,
  EVAL_NAMESPACE_PREFIX,
} from "../../config";
import { percentile } from "../../../src/server/lib/percentile";
import { retrieveFromNamespace } from "../../../src/server/services/retrieval";
import type { VectorStore } from "../../../src/server/services/vectorstore";
import type { CachedEmbedder } from "../embedder";
import { buildChunks, ensureIndexed } from "../indexer";
import { aggregate, ndcgAtK, type MetricSet, type QueryJudgement } from "../metrics";
import { assertEvalNamespace } from "../namespace";
import type { ChunkingConfig } from "../types";
import type { BeirDataset, BeirQuery } from "./dataset";
import {
  foldToDocuments,
  judgeDocumentRanking,
  missedDocuments,
  type RankedDocument,
} from "./judge";
import { mapAtEachK } from "./metrics";

/**
 * Running a BEIR dataset end to end.
 *
 * The pipeline is the same one `lib/runner.ts` drives — chunk with the
 * production chunker, embed through the cached production provider, upsert with
 * the production store, query through the production `retrieveFromNamespace` —
 * and it is deliberately not abstracted over. The two runners differ in exactly
 * one place, which is the place that matters: what counts as a correct answer.
 * A shared runner with a judging strategy injected would hide that difference
 * behind an interface rather than make it legible.
 */

/** The retrieval configuration a BEIR run varies. */
export interface BeirRetrievalConfig {
  /**
   * Chunks fetched per query, before folding to documents.
   *
   * Not the product's topK, and named differently to keep them from being
   * confused: BEIR scores a ranking of documents, and a document ranking deep
   * enough for recall@100 needs materially more than 100 chunks behind it.
   */
  chunkDepth: number;
}

export interface BeirQueryOutcome {
  query: BeirQuery;
  /** The folded document ranking, truncated to the largest reported cutoff. */
  documents: RankedDocument[];
  judgement: QueryJudgement;
  /** nDCG@10 — BEIR's headline, kept per query so failures can be ranked. */
  ndcg10: number | null;
  /** 1-based rank of the first relevant document; null if none was found. */
  firstRelevantRank: number | null;
  /** Judged-relevant documents that never appeared in the ranking. */
  missed: { documentId: string; grade: number }[];
  relevantTotal: number;
  chunksRetrieved: number;
  documentsRanked: number;
  embedMs: number;
  retrievalMs: number;
}

export interface BeirRun {
  dataset: BeirDataset;
  chunking: ChunkingConfig;
  retrieval: BeirRetrievalConfig;
  embeddingModel: string;
  namespace: string;
  chunkCount: number;
  indexReused: boolean;
  outcomes: BeirQueryOutcome[];
  overall: MetricSet;
  /** MAP at each cutoff — BEIR reports it, `MetricSet` does not carry it. */
  map: Record<number, number | null>;
  depth: DepthSummary;
  latency: LatencySummary;
  durationMs: number;
  embedderStats: CachedEmbedder["stats"];
}

/**
 * How deep the document rankings actually went.
 *
 * The reason this is reported rather than assumed: every metric at a cutoff
 * larger than the shallowest ranking is an *underestimate*, and it underestimates
 * silently. If documents-per-query lands near the largest k, the fix is a bigger
 * `--depth`, which costs no embedding quota.
 */
export interface DepthSummary {
  meanChunksRetrieved: number;
  meanDocumentsRanked: number;
  minDocumentsRanked: number;
  /** Retrieved chunks per distinct document — how much depth chunking costs. */
  chunksPerDocument: number;
  /** Queries whose ranking was shorter than the largest reported cutoff. */
  queriesShallowerThanMaxK: number;
  maxK: number;
}

export interface LatencySummary {
  embedMs: { p50: number | null; p95: number | null };
  retrievalMs: { p50: number | null; p95: number | null };
}

/**
 * Namespace for a BEIR index.
 *
 * Carries the EVAL_NAMESPACE_PREFIX so `eval:clean` finds and can delete it,
 * and uses the dataset slot of that convention so `eval:clean --dataset
 * beir-nfcorpus` targets only these. The hash covers exactly what determines
 * the vectors — the sampled corpus, the chunking, the model — and nothing that
 * only affects query time, so changing `--depth` re-embeds nothing.
 */
export function beirNamespace(
  dataset: BeirDataset,
  chunking: ChunkingConfig,
  embeddingModel: string,
): string {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        corpus: dataset.fingerprint,
        chunking,
        model: embeddingModel,
      }),
    )
    .digest("hex")
    .slice(0, 10);
  return `${EVAL_NAMESPACE_PREFIX}:beir-${dataset.name}:${hash}`;
}

export interface BeirRunOptions {
  dataset: BeirDataset;
  chunking: ChunkingConfig;
  retrieval: BeirRetrievalConfig;
  embeddingModel: string;
  store: VectorStore;
  embedder: CachedEmbedder;
  force: boolean;
  onProgress?: (message: string) => void;
}

export async function runBeir(options: BeirRunOptions): Promise<BeirRun> {
  const { dataset, chunking, retrieval, embeddingModel, store, embedder, force } = options;
  const startedAt = Date.now();
  const log = options.onProgress ?? (() => {});
  const statsBefore = { ...embedder.stats };

  const chunks = buildChunks(dataset.documents, chunking);
  const namespace = beirNamespace(dataset, chunking, embeddingModel);
  assertEvalNamespace(namespace);

  log(`chunked ${dataset.documents.length} documents into ${chunks.length} chunks`);
  const indexed = await ensureIndexed(store, embedder, {
    namespace,
    chunks,
    force,
    onProgress: log,
    visibilityTimeoutMs: BEIR_VISIBILITY_TIMEOUT_MS,
  });
  log(indexed.reused ? `reused existing index ${namespace}` : `indexed into ${namespace}`);

  // Vector count before and after the query loop. See the throw below.
  const countBefore = (await store.namespaceStats())[namespace] ?? 0;

  const maxK = Math.max(...BEIR_K_VALUES);
  const outcomes: BeirQueryOutcome[] = [];

  for (const [i, query] of dataset.queries.entries()) {
    const { chunks: retrieved, embedMs, retrievalMs } = await retrieveFromNamespace(
      embedder,
      store,
      { namespace, query: query.text, topK: retrieval.chunkDepth },
    );

    const ranked = foldToDocuments(
      retrieved.map((match) => ({
        chunkId: `${match.documentId}#${match.chunkIndex}`,
        documentId: match.documentId,
        score: match.score,
      })),
    );

    const qrels = dataset.qrels.get(query.id);
    const judgement = judgeDocumentRanking(ranked, qrels);
    const firstRelevant = judgement.gains.findIndex((gain) => gain > 0);

    outcomes.push({
      query,
      // Only the reported depth is retained. The full ranking is up to
      // `chunkDepth` documents across hundreds of queries, and nothing below
      // the largest cutoff affects a single number in the report.
      documents: ranked.slice(0, maxK),
      judgement,
      ndcg10: ndcgAtK(judgement, 10),
      firstRelevantRank: firstRelevant === -1 ? null : firstRelevant + 1,
      missed: missedDocuments(ranked, qrels),
      relevantTotal: judgement.idealGains.length,
      chunksRetrieved: retrieved.length,
      documentsRanked: ranked.length,
      embedMs,
      retrievalMs,
    });

    if ((i + 1) % 25 === 0 || i === dataset.queries.length - 1) {
      log(`queried ${i + 1}/${dataset.queries.length}`);
    }
  }

  // An index that changed underneath the query loop invalidates every number
  // computed from it. Pinecone deletes propagate asynchronously, so a recent
  // `eval:clean` can land *during* a run and progressively empty a namespace
  // that was verified full moments earlier — which does not error, it reports a
  // dramatic and entirely fictional regression.
  const countAfter = (await store.namespaceStats())[namespace] ?? 0;
  if (countAfter !== countBefore) {
    throw new Error(
      `The index changed while the ${dataset.name} run was in progress: ${namespace} held ` +
        `${countBefore} vectors before the queries and ${countAfter} after. These results are not ` +
        `trustworthy and have been discarded.\n\n` +
        `This almost always means a recent \`pnpm eval:clean\` is still propagating. Wait a few ` +
        `minutes and re-run — the embedding cache means the retry costs no quota.`,
    );
  }

  const judgements = outcomes.map((outcome) => outcome.judgement);

  return {
    dataset,
    chunking,
    retrieval,
    embeddingModel,
    namespace,
    chunkCount: chunks.length,
    indexReused: indexed.reused,
    outcomes,
    overall: aggregate(judgements, BEIR_K_VALUES),
    map: mapAtEachK(judgements, BEIR_K_VALUES),
    depth: summarizeDepth(outcomes, maxK),
    latency: summarizeLatency(outcomes),
    durationMs: Date.now() - startedAt,
    embedderStats: {
      cacheHits: embedder.stats.cacheHits - statsBefore.cacheHits,
      embedded: embedder.stats.embedded - statsBefore.embedded,
      requests: embedder.stats.requests - statsBefore.requests,
      tokens: embedder.stats.tokens - statsBefore.tokens,
    },
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeDepth(outcomes: BeirQueryOutcome[], maxK: number): DepthSummary {
  const chunksRetrieved = outcomes.map((outcome) => outcome.chunksRetrieved);
  const documentsRanked = outcomes.map((outcome) => outcome.documentsRanked);
  const totalChunks = chunksRetrieved.reduce((sum, value) => sum + value, 0);
  const totalDocuments = documentsRanked.reduce((sum, value) => sum + value, 0);

  return {
    meanChunksRetrieved: mean(chunksRetrieved),
    meanDocumentsRanked: mean(documentsRanked),
    minDocumentsRanked: documentsRanked.length > 0 ? Math.min(...documentsRanked) : 0,
    chunksPerDocument: totalDocuments === 0 ? 0 : totalChunks / totalDocuments,
    queriesShallowerThanMaxK: documentsRanked.filter((count) => count < maxK).length,
    maxK,
  };
}

/**
 * Latency percentiles per stage. Context, not a quality metric: a cached
 * embedding returns without a network call, so `embed p50` is only meaningful
 * on a cold cache.
 */
function summarizeLatency(outcomes: BeirQueryOutcome[]): LatencySummary {
  const embed = outcomes.map((outcome) => outcome.embedMs);
  const retrieval = outcomes.map((outcome) => outcome.retrievalMs);
  return {
    embedMs: { p50: percentile(embed, 0.5), p95: percentile(embed, 0.95) },
    retrievalMs: { p50: percentile(retrieval, 0.5), p95: percentile(retrieval, 0.95) },
  };
}

import { REPORT_K_VALUES } from "../config";
import { percentile } from "../../src/server/lib/percentile";
import { retrieveFromNamespace } from "../../src/server/services/retrieval";
import type { VectorStore } from "../../src/server/services/vectorstore";
import type { CorpusDocument } from "./corpus";
import type { CachedEmbedder } from "./embedder";
import { buildChunks, ensureIndexed, type IndexedChunk } from "./indexer";
import { aggregate, groupBy, type MetricSet, type QueryJudgement } from "./metrics";
import { evalNamespace, configHash, indexHash } from "./namespace";
import { relevanceGain } from "./relevance";
import type {
  GoldenItem,
  QueryOutcome,
  ResolvedExperiment,
  ScoredResult,
} from "./types";
import { goldenSpans } from "./types";

/**
 * Running one experiment end to end.
 *
 * chunk → embed → upsert → query → judge → aggregate. The middle three stages
 * are production code (`chunkPages`, `WorkersAiEmbeddingProvider` behind the
 * cache, `retrieveFromNamespace`); this file is the part that has no production
 * equivalent — deciding what counts as a correct answer.
 */

export interface ExperimentRun {
  experiment: ResolvedExperiment;
  namespace: string;
  indexHash: string;
  configHash: string;
  corpusFingerprint: string;
  /** Chunks in the index for this configuration. */
  chunkCount: number;
  indexReused: boolean;
  outcomes: QueryOutcome[];
  overall: MetricSet;
  byDifficulty: Record<string, MetricSet>;
  byTag: Record<string, MetricSet>;
  latency: LatencySummary;
  /** Wall-clock milliseconds for the whole experiment. */
  durationMs: number;
  embedderStats: CachedEmbedder["stats"];
}

export interface LatencySummary {
  embedMs: { p50: number | null; p95: number | null };
  retrievalMs: { p50: number | null; p95: number | null };
}

/**
 * Every chunk in the index that overlaps one of an item's golden spans.
 *
 * Computed over the full chunk list, not over what retrieval returned, which is
 * what lets recall and NDCG be measured against what retrieval *could* have
 * found. This is only knowable because the harness owns the chunking.
 */
function relevantChunksFor(
  item: GoldenItem,
  chunks: IndexedChunk[],
  experiment: ResolvedExperiment,
): { id: string; gain: number }[] {
  const spans = goldenSpans(item);
  const relevant: { id: string; gain: number }[] = [];
  for (const chunk of chunks) {
    if (chunk.documentId !== item.documentId) continue;
    const gain = relevanceGain(chunk, spans, experiment.relevance);
    if (gain > 0) relevant.push({ id: chunk.id, gain });
  }
  return relevant;
}

export interface RunOptions {
  experiment: ResolvedExperiment;
  documents: CorpusDocument[];
  corpusFingerprint: string;
  items: GoldenItem[];
  store: VectorStore;
  embedder: CachedEmbedder;
  force: boolean;
  onProgress?: (message: string) => void;
}

export async function runExperiment(options: RunOptions): Promise<ExperimentRun> {
  const { experiment, documents, corpusFingerprint, items, store, embedder, force } = options;
  const startedAt = Date.now();
  const log = options.onProgress ?? (() => {});
  // One embedder is shared across the experiments in a run so they can reuse
  // each other's cached vectors, which means its counters are cumulative.
  // Snapshot them here and report the delta, or every row after the first would
  // claim the whole run's spend.
  const statsBefore = { ...embedder.stats };

  const chunks = buildChunks(documents, experiment.chunking);
  const namespace = evalNamespace(experiment, corpusFingerprint);

  log(`chunked corpus into ${chunks.length} chunks`);
  const indexed = await ensureIndexed(store, embedder, { namespace, chunks, force, onProgress: log });
  log(indexed.reused ? `reused existing index ${namespace}` : `indexed into ${namespace}`);

  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const outcomes: QueryOutcome[] = [];

  // Vector count before the query loop, re-checked after it. See the throw
  // below for why this is not paranoia.
  const countBefore = (await store.namespaceStats())[namespace] ?? 0;

  for (const [i, item] of items.entries()) {
    const relevant = relevantChunksFor(item, chunks, experiment);

    const { chunks: retrieved, embedMs, retrievalMs } = await retrieveFromNamespace(
      embedder,
      store,
      { namespace, query: item.question, topK: experiment.retrieval.topK },
    );

    const results: ScoredResult[] = retrieved.map((match, index) => {
      const id = `${match.documentId}#${match.chunkIndex}`;
      // Prefer the locally-computed span over the stored metadata: identical in
      // practice, but it means a scoring run cannot be thrown off by a vector
      // left behind from an earlier chunking configuration.
      const local = chunkById.get(id);
      const span = {
        startChar: local?.startChar ?? match.startChar ?? 0,
        endChar: local?.endChar ?? match.endChar ?? 0,
        page: local?.page ?? match.page,
      };
      const gain =
        match.documentId === item.documentId
          ? relevanceGain(span, goldenSpans(item), experiment.relevance)
          : 0;

      return {
        rank: index + 1,
        chunkId: id,
        documentId: match.documentId,
        page: span.page,
        startChar: span.startChar,
        endChar: span.endChar,
        score: match.score,
        text: match.text,
        relevant: gain > 0,
        gain,
      };
    });

    const firstRelevant = results.find((r) => r.relevant);
    outcomes.push({
      item,
      results,
      firstRelevantRank: firstRelevant?.rank ?? null,
      relevantChunkIds: relevant.map((r) => r.id),
      embedMs,
      retrievalMs,
    });

    if ((i + 1) % 10 === 0 || i === items.length - 1) {
      log(`queried ${i + 1}/${items.length}`);
    }
  }

  // An index that changed underneath the query loop invalidates every number
  // computed from it. This is a real failure mode, not a hypothetical: Pinecone
  // deletes propagate asynchronously, so an `eval:clean` followed promptly by an
  // `eval:run` can have the stale delete land *during* the run and progressively
  // empty a namespace that was verified full moments earlier. The symptom is a
  // config scoring 0.04 hit@1 where an identical one scored 0.74 — a dramatic,
  // entirely fictional regression that is far worse than an error, because it
  // looks like a finding.
  const countAfter = (await store.namespaceStats())[namespace] ?? 0;
  if (countAfter !== countBefore) {
    throw new Error(
      `The index changed while ${experiment.name} was running: ${namespace} held ${countBefore} ` +
        `vectors before the queries and ${countAfter} after. These results are not trustworthy and ` +
        `have been discarded.\n\n` +
        `This almost always means a recent \`pnpm eval:clean\` is still propagating. Wait a few ` +
        `minutes and re-run — the embedding cache means the retry costs no quota.`,
    );
  }

  const judgements = new Map<string, QueryJudgement>(
    outcomes.map((outcome) => [
      outcome.item.id,
      {
        gains: outcome.results.map((r) => r.gain),
        idealGains: relevantChunksFor(outcome.item, chunks, experiment).map((r) => r.gain),
      },
    ]),
  );
  const judgementsFor = (group: QueryOutcome[]) =>
    group.map((outcome) => judgements.get(outcome.item.id)!);

  const byDifficulty: Record<string, MetricSet> = {};
  for (const [key, group] of groupBy(outcomes, (o) => o.item.difficulty)) {
    byDifficulty[key] = aggregate(judgementsFor(group), REPORT_K_VALUES);
  }

  const byTag: Record<string, MetricSet> = {};
  for (const [key, group] of groupBy(outcomes, (o) => o.item.tags)) {
    byTag[key] = aggregate(judgementsFor(group), REPORT_K_VALUES);
  }

  return {
    experiment,
    namespace,
    indexHash: indexHash(experiment, corpusFingerprint),
    configHash: configHash(experiment, corpusFingerprint),
    corpusFingerprint,
    chunkCount: chunks.length,
    indexReused: indexed.reused,
    outcomes,
    overall: aggregate(judgementsFor(outcomes), REPORT_K_VALUES),
    byDifficulty,
    byTag,
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

/**
 * Latency percentiles per stage. Context, not a headline: a cached embedding
 * returns in microseconds and would flatter any run of a warm cache, so the
 * report labels these accordingly.
 */
function summarizeLatency(outcomes: QueryOutcome[]): LatencySummary {
  const embed = outcomes.map((o) => o.embedMs);
  const retrieval = outcomes.map((o) => o.retrievalMs);
  return {
    embedMs: { p50: percentile(embed, 0.5), p95: percentile(embed, 0.95) },
    retrievalMs: { p50: percentile(retrieval, 0.5), p95: percentile(retrieval, 0.95) },
  };
}

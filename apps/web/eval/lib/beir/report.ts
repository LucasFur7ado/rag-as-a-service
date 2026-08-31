import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BEIR_FAILURE_CONTEXT_DOCS,
  BEIR_K_VALUES,
  BEIR_REFERENCE_NDCG10,
  MAX_BEIR_FAILURES_REPORTED,
  RESULTS_DIR,
} from "../../config";
import { writeJsonl } from "../dataset";
import type { BeirRun } from "./runner";

/**
 * Turning a BEIR run into something a person can act on.
 *
 * Same three artifacts as the span-based harness, same jobs: `metrics.json` for
 * diffing runs over time, `report.md` as the deliverable, `failures.jsonl` for
 * the queries that went wrong. What differs is the unit — a failure record here
 * names documents, not chunks — and the caveats, which are the point of the
 * file: a BEIR number is only meaningful next to a statement of what was
 * indexed and how deep the ranking went.
 */

const fmt = (value: number | null, digits = 3): string =>
  value === null ? "—" : value.toFixed(digits);

export interface BeirReportInput {
  run: BeirRun;
  startedAt: Date;
}

export function resultDir(startedAt: Date, run: BeirRun): string {
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return resolve(RESULTS_DIR, `${stamp}-beir-${run.dataset.name}-${run.dataset.split}`);
}

export function writeBeirResults(input: BeirReportInput): string {
  const dir = resultDir(input.startedAt, input.run);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    resolve(dir, "metrics.json"),
    `${JSON.stringify(buildMetricsJson(input), null, 2)}\n`,
    "utf8",
  );
  writeFileSync(resolve(dir, "report.md"), buildMarkdown(input), "utf8");
  writeJsonl(resolve(dir, "failures.jsonl"), buildFailures(input.run));

  return dir;
}

// --- metrics.json -----------------------------------------------------------

function buildMetricsJson(input: BeirReportInput) {
  const { run } = input;
  return {
    generatedAt: input.startedAt.toISOString(),
    benchmark: "beir",
    dataset: {
      name: run.dataset.name,
      split: run.dataset.split,
      dir: run.dataset.dir,
      fingerprint: run.dataset.fingerprint,
      sampling: run.dataset.sampling,
      totalChars: run.dataset.totalChars,
      /** Mean judged-relevant documents per query — the recall denominator. */
      meanRelevantPerQuery:
        run.outcomes.length === 0
          ? 0
          : run.outcomes.reduce((sum, outcome) => sum + outcome.relevantTotal, 0) /
            run.outcomes.length,
    },
    kValues: BEIR_K_VALUES,
    config: {
      embeddingModel: run.embeddingModel,
      chunking: run.chunking,
      retrieval: run.retrieval,
    },
    namespace: run.namespace,
    chunkCount: run.chunkCount,
    indexReused: run.indexReused,
    durationMs: run.durationMs,
    embedder: run.embedderStats,
    latency: run.latency,
    depth: run.depth,
    overall: run.overall,
    map: run.map,
    comparable: isComparable(run),
  };
}

// --- failures.jsonl ---------------------------------------------------------

/**
 * The worst queries first, ranked by nDCG@10 — BEIR's headline metric, so the
 * head of this file is where the reported number actually came from.
 *
 * Each row carries both halves of a failure: the documents that were ranked
 * highest (with their grades, so a "failure" that retrieved only unjudged
 * documents is visible as such) and the judged documents that never appeared.
 */
function buildFailures(run: BeirRun) {
  const ranked = [...run.outcomes].sort((a, b) => (a.ndcg10 ?? -1) - (b.ndcg10 ?? -1));

  return ranked.slice(0, MAX_BEIR_FAILURES_REPORTED).map((outcome) => ({
    queryId: outcome.query.id,
    query: outcome.query.text,
    ndcg10: outcome.ndcg10 === null ? null : Number(outcome.ndcg10.toFixed(4)),
    firstRelevantRank: outcome.firstRelevantRank,
    relevantTotal: outcome.relevantTotal,
    relevantRetrieved: outcome.judgement.gains.filter((gain) => gain > 0).length,
    documentsRanked: outcome.documentsRanked,
    diagnosis: diagnose(outcome),
    retrieved: outcome.documents.slice(0, BEIR_FAILURE_CONTEXT_DOCS).map((document) => ({
      rank: document.rank,
      documentId: document.documentId,
      title: run.dataset.titles.get(document.documentId) ?? "",
      score: Number(document.score.toFixed(4)),
      grade: outcome.judgement.gains[document.rank - 1] ?? 0,
      chunkId: document.chunkId,
      chunkRank: document.chunkRank,
      chunksRetrieved: document.chunkCount,
    })),
    missed: outcome.missed.slice(0, BEIR_FAILURE_CONTEXT_DOCS).map((miss) => ({
      documentId: miss.documentId,
      grade: miss.grade,
      title: run.dataset.titles.get(miss.documentId) ?? "",
    })),
  }));
}

function diagnose(outcome: { firstRelevantRank: number | null; relevantTotal: number }): string {
  if (outcome.relevantTotal === 0) {
    return "dataset: this query has no judgement in the split — it should have been filtered out";
  }
  if (outcome.firstRelevantRank === null) {
    return "miss: no judged document was retrieved at any depth — semantic gap, or the query needs lexical matching";
  }
  if (outcome.firstRelevantRank > 10) {
    return `ranked ${outcome.firstRelevantRank} — relevant documents exist in the ranking but fall outside the nDCG@10 window`;
  }
  return `ranked ${outcome.firstRelevantRank} of ${outcome.relevantTotal} relevant — partial recall`;
}

// --- report.md --------------------------------------------------------------

/**
 * Whether this run's numbers can honestly be read against a published one.
 *
 * Requires the full corpus AND the full query set for the split. A sampled
 * corpus is a smaller haystack and scores higher for reasons unrelated to
 * retrieval quality; a sampled query set is noisier but unbiased. Both break
 * comparability, and the second is easy to forget.
 */
function isComparable(run: BeirRun): boolean {
  const { sampling } = run.dataset;
  return !sampling.pooledCorpus && sampling.queriesUsed === sampling.queriesAvailable;
}

function buildMarkdown(input: BeirReportInput): string {
  const { run } = input;
  const { sampling } = run.dataset;
  const out: string[] = [];

  out.push(`# BEIR retrieval evaluation — ${run.dataset.name} (${run.dataset.split})`);
  out.push("");
  out.push(`_${input.startedAt.toISOString()}_`);
  out.push("");
  out.push(
    `${sampling.queriesUsed} queries · ${sampling.documentsUsed.toLocaleString()} documents · ` +
      `${run.chunkCount.toLocaleString()} chunks · corpus \`${run.dataset.fingerprint}\``,
  );
  out.push("");

  const caveats = buildCaveats(run);
  if (caveats.length > 0) {
    out.push("> **Read these first**");
    for (const caveat of caveats) out.push(`> - ${caveat}`);
    out.push("");
  }

  out.push("## What was measured");
  out.push("");
  out.push(
    "Ground truth here is **whole documents**, not source spans. BEIR's answer key names a " +
      "document and a grade per (query, document) pair, so a retrieved chunk is judged by which " +
      "document it came from. Retrieval returns a ranking of chunks; that ranking is folded into a " +
      "ranking of documents — each document entering at the position of its best-scoring chunk, " +
      "once — and the document ranking is what every metric below scores.",
  );
  out.push("");
  out.push(
    "That fold is what makes a chunked system comparable to a document-level benchmark. Scoring " +
      "the chunk ranking directly would answer a different and worse question: a query whose one " +
      "relevant document produced five chunks would count as five successes.",
  );
  out.push("");

  out.push("## Configuration");
  out.push("");
  out.push("| Setting | Value |");
  out.push("| --- | --- |");
  out.push(`| Embedding model | \`${run.embeddingModel}\` |`);
  out.push(`| Chunk size | ${run.chunking.sizeChars} chars |`);
  out.push(
    `| Chunk overlap | ${run.chunking.overlapChars} chars ` +
      `(${Math.round((run.chunking.overlapChars / run.chunking.sizeChars) * 100)}%) |`,
  );
  out.push(`| Chunks retrieved per query | ${run.retrieval.chunkDepth} |`);
  out.push(`| Documents indexed | ${sampling.documentsUsed.toLocaleString()} of ${sampling.documentsAvailable.toLocaleString()} |`);
  out.push(`| Queries scored | ${sampling.queriesUsed} of ${sampling.queriesAvailable} judged |`);
  out.push(`| Sampling seed | ${sampling.seed} |`);
  out.push(`| Namespace | \`${run.namespace}\` |`);
  out.push(`| Index reused | ${run.indexReused ? "yes" : "no — freshly embedded"} |`);
  out.push("");

  out.push("## Headline metrics");
  out.push("");
  out.push(metricsTable(run));
  out.push("");
  out.push(
    `**nDCG@10 = ${fmt(run.overall.atK[10].ndcg)}** is BEIR's headline for this dataset. ` +
      `MRR ${fmt(run.overall.mrr)} · ${run.overall.completeMisses} complete miss` +
      `${run.overall.completeMisses === 1 ? "" : "es"} out of ${run.overall.queries} queries.`,
  );
  out.push("");

  const references = BEIR_REFERENCE_NDCG10[run.dataset.name];
  if (references && references.length > 0) {
    out.push("### Reference points");
    out.push("");
    if (isComparable(run)) {
      out.push(
        "Published nDCG@10 on this dataset and split, for reading the number above against " +
          "something. These are quoted from their sources, not measured here.",
      );
      out.push("");
      out.push("| System | nDCG@10 | Source |");
      out.push("| --- | ---: | --- |");
      for (const reference of references) {
        out.push(`| ${reference.system} | ${reference.ndcg10.toFixed(3)} | ${reference.source} |`);
      }
      out.push("");
      out.push(
        "For current dense-model numbers on the same splits, see the MTEB retrieval leaderboard: " +
          "https://huggingface.co/spaces/mteb/leaderboard",
      );
    } else {
      out.push(
        "**Suppressed.** This run sampled the corpus and/or the query set, so its numbers are not " +
          "comparable to a published figure — a smaller corpus is a smaller haystack, and every " +
          "metric rises for reasons that have nothing to do with retrieval quality. Re-run over the " +
          "full corpus and the full split to see the comparison.",
      );
    }
    out.push("");
  }

  out.push("## Ranking depth");
  out.push("");
  out.push(
    "Chunk retrieval is deeper than document retrieval, because several retrieved chunks " +
      "routinely come from the same document. Any cutoff larger than the shallowest ranking is an " +
      "underestimate — and an invisible one, so the numbers are here.",
  );
  out.push("");
  out.push("| | Value |");
  out.push("| --- | ---: |");
  out.push(`| Chunks retrieved per query | ${run.depth.meanChunksRetrieved.toFixed(1)} |`);
  out.push(`| Documents ranked per query (mean) | ${run.depth.meanDocumentsRanked.toFixed(1)} |`);
  out.push(`| Documents ranked (minimum) | ${run.depth.minDocumentsRanked} |`);
  out.push(`| Chunks per distinct document | ${run.depth.chunksPerDocument.toFixed(2)} |`);
  out.push(
    `| Queries ranking fewer than ${run.depth.maxK} documents | ${run.depth.queriesShallowerThanMaxK} |`,
  );
  out.push("");

  out.push("## Latency and spend");
  out.push("");
  out.push(
    "Latency is context, not a quality metric — a cached embedding returns without a network " +
      "call, so `embed p50` is only meaningful on a cold cache.",
  );
  out.push("");
  out.push("| embed p50 | embed p95 | pinecone p50 | pinecone p95 | embedded | cache hits | requests | duration |");
  out.push("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  out.push(
    `| ${fmt(run.latency.embedMs.p50, 0)}ms | ${fmt(run.latency.embedMs.p95, 0)}ms ` +
      `| ${fmt(run.latency.retrievalMs.p50, 0)}ms | ${fmt(run.latency.retrievalMs.p95, 0)}ms ` +
      `| ${run.embedderStats.embedded.toLocaleString()} | ${run.embedderStats.cacheHits.toLocaleString()} ` +
      `| ${run.embedderStats.requests} | ${(run.durationMs / 1000).toFixed(1)}s |`,
  );
  out.push("");

  out.push("## Method");
  out.push("");
  out.push(
    "`nDCG` uses **linear** gains (`gain = qrel grade`), which is what trec_eval's `ndcg_cut` — " +
      "and therefore every published BEIR number — computes. `recall@k` is the fraction of a " +
      "query's judged-relevant documents that reach the top k, so on a dataset with many " +
      "judgements per query it is bounded well below 1 by the answer key itself. `MAP@k` " +
      "normalizes by the total number of relevant documents rather than by k, matching " +
      "`map_cut`; graded qrels are binarized for it, as trec_eval does.",
  );
  out.push("");
  out.push(
    "The retrieval path is the product's own `retrieveFromNamespace`, over vectors written by the " +
      "production chunker and embedding provider. What this harness adds is the answer key and the " +
      "fold from chunks to documents.",
  );
  out.push("");
  out.push("See `failures.jsonl` in this directory for the worst queries by nDCG@10.");
  out.push("");

  return out.join("\n");
}

function buildCaveats(run: BeirRun): string[] {
  const caveats: string[] = [];
  const { sampling } = run.dataset;

  if (sampling.pooledCorpus) {
    caveats.push(
      `**Not comparable to a published number.** The corpus was cut to ` +
        `${sampling.documentsUsed.toLocaleString()} of ${sampling.documentsAvailable.toLocaleString()} ` +
        "documents. Every judged document was kept and the rest of the budget filled with " +
        "distractors, so the answer key is intact — but a smaller haystack means fewer things to " +
        "rank above the right one, and every metric below is inflated. Use it to compare " +
        "configurations against each other, not against BEIR.",
    );
  }
  if (sampling.queriesUsed < sampling.queriesAvailable) {
    caveats.push(
      `Only ${sampling.queriesUsed} of ${sampling.queriesAvailable} judged queries were run ` +
        `(seed ${sampling.seed}). The sample is unbiased but noisier; small differences between ` +
        "runs are not signal.",
    );
  }
  if (sampling.danglingQrels > 0) {
    caveats.push(
      `${sampling.danglingQrels.toLocaleString()} judgement(s) name a document that is not in ` +
        "`corpus.jsonl` and were dropped. A large count means the qrels and the corpus came from " +
        "different releases of the dataset.",
    );
  }
  if (run.depth.queriesShallowerThanMaxK > 0) {
    caveats.push(
      `${run.depth.queriesShallowerThanMaxK} quer${run.depth.queriesShallowerThanMaxK === 1 ? "y" : "ies"} ` +
        `ranked fewer than ${run.depth.maxK} documents, so metrics at the largest cutoff are ` +
        "underestimates. Raise `--depth` — it costs no embedding quota, only a bigger response.",
    );
  }
  if (run.dataset.split === "train") {
    caveats.push(
      "This is the **train** split. Published BEIR numbers are measured on `test`; train qrels are " +
        "larger, differently distributed, and not a substitute.",
    );
  }
  if (run.overall.queries < 50) {
    caveats.push(
      `Only ${run.overall.queries} queries: differences smaller than a few points are noise.`,
    );
  }
  return caveats;
}

function metricsTable(run: BeirRun): string {
  const header = ["k", "nDCG@k", "recall@k", "precision@k", "hit-rate@k", "MAP@k"];
  const rows = BEIR_K_VALUES.map((k) => [
    String(k),
    fmt(run.overall.atK[k].ndcg),
    fmt(run.overall.atK[k].recall),
    fmt(run.overall.atK[k].precision),
    fmt(run.overall.atK[k].hitRate),
    fmt(run.map[k]),
  ]);

  const separator = header.map((_, i) => (i === 0 ? "---" : "---:"));
  return [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

// --- console ----------------------------------------------------------------

/** The at-a-glance summary printed when a run finishes. */
export function printBeirSummary(run: BeirRun, dir: string): void {
  console.log("");
  console.log(`  Results — ${run.dataset.name} (${run.dataset.split})`);
  console.log("  " + "─".repeat(72));
  console.log(
    `  ${"k".padEnd(6)}${"nDCG@k".padStart(10)}${"recall@k".padStart(11)}` +
      `${"prec@k".padStart(10)}${"hit@k".padStart(9)}${"MAP@k".padStart(10)}`,
  );
  for (const k of BEIR_K_VALUES) {
    const atK = run.overall.atK[k];
    console.log(
      `  ${String(k).padEnd(6)}${fmt(atK.ndcg).padStart(10)}${fmt(atK.recall).padStart(11)}` +
        `${fmt(atK.precision).padStart(10)}${fmt(atK.hitRate).padStart(9)}` +
        `${fmt(run.map[k]).padStart(10)}`,
    );
  }
  console.log("  " + "─".repeat(72));
  console.log(
    `  ${run.overall.queries} queries · MRR ${fmt(run.overall.mrr)} · ` +
      `${run.overall.completeMisses} complete miss${run.overall.completeMisses === 1 ? "" : "es"}`,
  );
  if (!isComparable(run)) {
    console.log("");
    console.log(
      "  ! Sampled run — these numbers are NOT comparable to published BEIR figures.\n" +
        "    See the caveats at the top of report.md.",
    );
  }
  console.log("");
  console.log(`  Report:   ${resolve(dir, "report.md")}`);
  console.log(`  Failures: ${resolve(dir, "failures.jsonl")}`);
  console.log("");
}

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FAILURE_CONTEXT_CHUNKS,
  FAILURE_SNIPPET_CHARS,
  MAX_FAILURES_REPORTED,
  REPORT_K_VALUES,
  RESULTS_DIR,
} from "../config";
import { byDocumentId, excerptSpan, type CorpusDocument } from "./corpus";
import { writeJsonl } from "./dataset";
import type { MetricSet } from "./metrics";
import { describeRule } from "./relevance";
import type { ExperimentRun } from "./runner";
import { goldenSpans, type DatasetManifest, type QueryOutcome } from "./types";

/**
 * Turning a run into something a person can act on.
 *
 * Three artifacts, with different jobs:
 *
 * - `metrics.json` — everything, machine-readable, for diffing runs over time.
 * - `report.md` — the deliverable: what changed, against a baseline, with the
 *   caveats that make the numbers interpretable.
 * - `failures.jsonl` — the queries retrieval got wrong, each with the golden
 *   span and the chunks that beat it, because an aggregate metric tells you a
 *   config got worse and never tells you why.
 */

const fmt = (value: number | null, digits = 3): string =>
  value === null ? "—" : value.toFixed(digits);

/** A signed delta, or an em dash when either side is undefined. */
function delta(current: number | null, baseline: number | null, digits = 3): string {
  if (current === null || baseline === null) return "—";
  const diff = current - baseline;
  if (Math.abs(diff) < 10 ** -digits / 2) return "±0";
  return `${diff > 0 ? "+" : ""}${diff.toFixed(digits)}`;
}

export interface ReportInput {
  runs: ExperimentRun[];
  documents: CorpusDocument[];
  dataset: { name: string; manifest: DatasetManifest | null; itemCount: number };
  /** Experiment name used as the comparison baseline. */
  baseline: string;
  startedAt: Date;
}

/** Directory a run's artifacts are written to. */
export function resultDir(startedAt: Date, runs: ExperimentRun[]): string {
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const label = runs.length === 1 ? runs[0].experiment.name : `${runs.length}-configs`;
  return resolve(RESULTS_DIR, `${stamp}-${label}`);
}

export function writeResults(input: ReportInput): string {
  const dir = resultDir(input.startedAt, input.runs);
  mkdirSync(dir, { recursive: true });

  writeFileSync(resolve(dir, "metrics.json"), `${JSON.stringify(buildMetricsJson(input), null, 2)}\n`, "utf8");
  writeFileSync(resolve(dir, "report.md"), buildMarkdown(input), "utf8");
  writeJsonl(resolve(dir, "failures.jsonl"), buildFailures(input));

  return dir;
}

// --- metrics.json -----------------------------------------------------------

function buildMetricsJson(input: ReportInput) {
  return {
    generatedAt: input.startedAt.toISOString(),
    dataset: {
      name: input.dataset.name,
      itemCount: input.dataset.itemCount,
      manifest: input.dataset.manifest,
    },
    baseline: input.baseline,
    kValues: REPORT_K_VALUES,
    experiments: input.runs.map((run) => ({
      name: run.experiment.name,
      description: run.experiment.description,
      config: {
        embeddingModel: run.experiment.embeddingModel,
        chunking: run.experiment.chunking,
        retrieval: run.experiment.retrieval,
        relevance: run.experiment.relevance,
      },
      namespace: run.namespace,
      indexHash: run.indexHash,
      configHash: run.configHash,
      corpusFingerprint: run.corpusFingerprint,
      chunkCount: run.chunkCount,
      indexReused: run.indexReused,
      durationMs: run.durationMs,
      embedder: run.embedderStats,
      latency: run.latency,
      overall: run.overall,
      byDifficulty: run.byDifficulty,
      byTag: run.byTag,
    })),
  };
}

// --- failures.jsonl ---------------------------------------------------------

/**
 * The worst queries first: complete misses, then the ones whose first relevant
 * chunk ranked lowest. Reading the head of this file is meant to be the first
 * thing anyone does after a regression.
 */
function buildFailures(input: ReportInput) {
  const docs = byDocumentId(input.documents);
  const rows: unknown[] = [];

  for (const run of input.runs) {
    const ranked = [...run.outcomes].sort(
      (a, b) => (b.firstRelevantRank ?? Infinity) - (a.firstRelevantRank ?? Infinity),
    );
    const failing = ranked.filter((o) => o.firstRelevantRank !== 1);

    for (const outcome of failing.slice(0, MAX_FAILURES_REPORTED)) {
      const doc = docs.get(outcome.item.documentId);
      rows.push({
        experiment: run.experiment.name,
        questionId: outcome.item.id,
        question: outcome.item.question,
        difficulty: outcome.item.difficulty ?? null,
        tags: outcome.item.tags ?? [],
        firstRelevantRank: outcome.firstRelevantRank,
        // No relevant chunk exists at all → the dataset is wrong, not retrieval.
        diagnosis: diagnose(outcome),
        golden: {
          documentId: outcome.item.documentId,
          spans: goldenSpans(outcome.item),
          text: doc ? excerptSpan(doc, outcome.item.sourceSpan, FAILURE_SNIPPET_CHARS) : "",
        },
        relevantChunksInIndex: outcome.relevantChunkIds,
        retrieved: outcome.results.slice(0, FAILURE_CONTEXT_CHUNKS).map((r) => ({
          rank: r.rank,
          chunkId: r.chunkId,
          score: Number(r.score.toFixed(4)),
          relevant: r.relevant,
          page: r.page,
          span: [r.startChar, r.endChar],
          text: r.text.slice(0, FAILURE_SNIPPET_CHARS),
        })),
      });
    }
  }
  return rows;
}

function diagnose(outcome: QueryOutcome): string {
  if (outcome.relevantChunkIds.length === 0) {
    return "dataset: the golden span matches no chunk in the index — check the span offsets";
  }
  if (outcome.firstRelevantRank === null) {
    return "miss: no relevant chunk was retrieved at all — semantic gap, or the answer needs lexical matching";
  }
  return `ranked ${outcome.firstRelevantRank} — relevant content was found but outranked`;
}

// --- report.md --------------------------------------------------------------

function buildMarkdown(input: ReportInput): string {
  const { runs, baseline, dataset } = input;
  const baselineRun = runs.find((r) => r.experiment.name === baseline) ?? runs[0];
  const out: string[] = [];

  out.push(`# Retrieval evaluation — ${dataset.name}`);
  out.push("");
  out.push(`_${input.startedAt.toISOString()}_`);
  out.push("");
  out.push(
    `${dataset.itemCount} questions · ${input.documents.length} corpus documents · ` +
      `${runs.length} configuration${runs.length === 1 ? "" : "s"}`,
  );
  out.push("");

  // Caveats first: they change how every number below should be read.
  const caveats = buildCaveats(input);
  if (caveats.length > 0) {
    out.push("> **Read these first**");
    for (const caveat of caveats) out.push(`> - ${caveat}`);
    out.push("");
  }

  out.push("## Configurations");
  out.push("");
  out.push("| Experiment | Chunk | Overlap | topK | Mode | Rerank | Chunks indexed |");
  out.push("| --- | ---: | ---: | ---: | --- | --- | ---: |");
  for (const run of runs) {
    const { chunking, retrieval } = run.experiment;
    const marker = run.experiment.name === baselineRun.experiment.name ? " _(baseline)_" : "";
    out.push(
      `| \`${run.experiment.name}\`${marker} | ${chunking.sizeChars} | ${chunking.overlapChars}` +
        ` (${Math.round((chunking.overlapChars / chunking.sizeChars) * 100)}%) | ${retrieval.topK}` +
        ` | ${retrieval.mode} | ${retrieval.rerank ? "on" : "off"} | ${run.chunkCount} |`,
    );
  }
  out.push("");

  out.push("## Headline metrics");
  out.push("");
  out.push(metricsTable(runs));
  out.push("");

  if (runs.length > 1) {
    out.push(`## Comparison vs \`${baselineRun.experiment.name}\``);
    out.push("");
    out.push(
      "Deltas are absolute differences against the baseline row. Positive is better for every " +
        "column except mean-first-rank and misses, where lower is better.",
    );
    out.push("");
    out.push(comparisonTable(runs, baselineRun));
    out.push("");
  }

  out.push("## Breakdown by difficulty");
  out.push("");
  out.push(breakdownTable(runs, (run) => run.byDifficulty, ["easy", "medium", "hard"]));
  out.push("");

  const tagKeys = [...new Set(runs.flatMap((run) => Object.keys(run.byTag)))].sort();
  if (tagKeys.length > 0) {
    out.push("## Breakdown by tag");
    out.push("");
    out.push(breakdownTable(runs, (run) => run.byTag, tagKeys));
    out.push("");
  }

  out.push("## Latency and spend");
  out.push("");
  out.push(
    "Latency is context, not a quality metric — a cached embedding returns without a network " +
      "call, so `embed p50` is only meaningful on a cold cache.",
  );
  out.push("");
  out.push("| Experiment | embed p50 | embed p95 | pinecone p50 | pinecone p95 | embedded | cache hits | requests | duration |");
  out.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const run of runs) {
    const { embedMs, retrievalMs } = run.latency;
    out.push(
      `| \`${run.experiment.name}\` | ${fmt(embedMs.p50, 0)}ms | ${fmt(embedMs.p95, 0)}ms` +
        ` | ${fmt(retrievalMs.p50, 0)}ms | ${fmt(retrievalMs.p95, 0)}ms` +
        ` | ${run.embedderStats.embedded} | ${run.embedderStats.cacheHits}` +
        ` | ${run.embedderStats.requests} | ${(run.durationMs / 1000).toFixed(1)}s |`,
    );
  }
  out.push("");

  out.push("## Method");
  out.push("");
  out.push(
    `Relevance rule: **${describeRule(runs[0].experiment.relevance)}**, judged by overlapping a ` +
      "retrieved chunk's source span with the golden span. Ground truth is anchored to source " +
      "character offsets, never to chunk ids, which is what makes the chunk-size rows above " +
      "comparable to each other at all.",
  );
  out.push("");
  out.push(
    "`recall@k` is measured against every chunk in the index that overlaps the golden span — " +
      "including chunks retrieval never returned — not against the retrieved set. `hit-rate@k` " +
      "asks only whether at least one relevant chunk made the cutoff.",
  );
  out.push("");
  out.push("See `failures.jsonl` in this directory for the queries that went wrong, worst first.");
  out.push("");
  out.push("<!-- TODO: generation eval — faithfulness, answer relevance, and LLM-as-judge scoring");
  out.push("     would attach here as a second section, sharing this dataset's questions but");
  out.push("     scoring the generated answer rather than the retrieved chunks. Out of scope for");
  out.push("     this harness, which measures retrieval only. -->");
  out.push("");

  return out.join("\n");
}

function buildCaveats(input: ReportInput): string[] {
  const caveats: string[] = [];
  const manifest = input.dataset.manifest;

  if (manifest && manifest.provenance !== "manual" && !manifest.humanReviewed) {
    caveats.push(
      `**Lower confidence:** this dataset is ${manifest.provenance} and has not been human-reviewed. ` +
        `Questions were generated by \`${manifest.generatorModel ?? "an unrecorded model"}\`; ` +
        "treat absolute values as indicative and trust the *relative* ordering of configurations more than the numbers.",
    );
  }
  if (!manifest) {
    caveats.push("No dataset manifest was found, so provenance is unknown.");
  }

  const unjudgeable = input.runs[0]?.overall.unjudgeable ?? 0;
  if (unjudgeable > 0) {
    caveats.push(
      `${unjudgeable} question(s) have a golden span that matches no chunk in the index. These are ` +
        "dataset bugs, not retrieval failures; they are excluded from recall and NDCG. Find them in `failures.jsonl`.",
    );
  }

  const sizes = new Set(input.runs.map((r) => r.experiment.chunking.sizeChars));
  if (input.runs.length > 1 && sizes.size > 1) {
    caveats.push(
      "Configurations here index different chunk counts, so `precision@k` is not directly comparable " +
        "between them — a smaller chunk holds less of the answer per slot. Compare recall and NDCG.",
    );
  }
  if (input.dataset.itemCount < 30) {
    caveats.push(
      `Only ${input.dataset.itemCount} questions: differences smaller than a few points are noise. ` +
        "Grow the dataset before acting on a small delta.",
    );
  }
  return caveats;
}

function metricsTable(runs: ExperimentRun[]): string {
  const header = ["Experiment", "queries"];
  for (const k of REPORT_K_VALUES) header.push(`hit@${k}`, `recall@${k}`, `ndcg@${k}`);
  header.push("MRR", "mean rank", "misses");

  const rows = runs.map((run) => {
    const cells = [`\`${run.experiment.name}\``, String(run.overall.queries)];
    for (const k of REPORT_K_VALUES) {
      cells.push(
        fmt(run.overall.atK[k].hitRate),
        fmt(run.overall.atK[k].recall),
        fmt(run.overall.atK[k].ndcg),
      );
    }
    cells.push(
      fmt(run.overall.mrr),
      fmt(run.overall.meanFirstRank, 2),
      String(run.overall.completeMisses),
    );
    return cells;
  });

  return table(header, rows);
}

function comparisonTable(runs: ExperimentRun[], baseline: ExperimentRun): string {
  const header = ["Experiment", "recall@5 Δ", "ndcg@5 Δ", "MRR Δ", "hit@1 Δ", "misses Δ"];
  const rows = runs.map((run) => [
    `\`${run.experiment.name}\`${run.experiment.name === baseline.experiment.name ? " _(baseline)_" : ""}`,
    delta(run.overall.atK[5].recall, baseline.overall.atK[5].recall),
    delta(run.overall.atK[5].ndcg, baseline.overall.atK[5].ndcg),
    delta(run.overall.mrr, baseline.overall.mrr),
    delta(run.overall.atK[1].hitRate, baseline.overall.atK[1].hitRate),
    delta(run.overall.completeMisses, baseline.overall.completeMisses, 0),
  ]);
  return table(header, rows);
}

function breakdownTable(
  runs: ExperimentRun[],
  select: (run: ExperimentRun) => Record<string, MetricSet>,
  keys: string[],
): string {
  const present = keys.filter((key) => runs.some((run) => select(run)[key]));
  if (present.length === 0) return "_No breakdown available — the dataset carries no such labels._";

  const header = ["Experiment", ...present.flatMap((key) => [`${key} n`, `${key} recall@5`])];
  const rows = runs.map((run) => {
    const cells = [`\`${run.experiment.name}\``];
    for (const key of present) {
      const set = select(run)[key];
      cells.push(set ? String(set.queries) : "—", set ? fmt(set.atK[5].recall) : "—");
    }
    return cells;
  });
  return table(header, rows);
}

function table(header: string[], rows: string[][]): string {
  const separator = header.map((_, i) => (i === 0 ? "---" : "---:"));
  return [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

// --- console ----------------------------------------------------------------

/** The at-a-glance summary printed when a run finishes. */
export function printSummary(runs: ExperimentRun[], baselineName: string, dir: string): void {
  const baseline = runs.find((r) => r.experiment.name === baselineName) ?? runs[0];

  console.log("");
  console.log("  Results");
  console.log("  " + "─".repeat(76));
  console.log(
    `  ${"experiment".padEnd(22)}${"hit@1".padStart(8)}${"recall@5".padStart(10)}` +
      `${"ndcg@5".padStart(9)}${"MRR".padStart(8)}${"misses".padStart(9)}${"Δrecall".padStart(10)}`,
  );
  for (const run of runs) {
    const o = run.overall;
    const isBaseline = run.experiment.name === baseline.experiment.name;
    console.log(
      `  ${run.experiment.name.slice(0, 21).padEnd(22)}` +
        `${fmt(o.atK[1].hitRate).padStart(8)}${fmt(o.atK[5].recall).padStart(10)}` +
        `${fmt(o.atK[5].ndcg).padStart(9)}${fmt(o.mrr).padStart(8)}` +
        `${String(o.completeMisses).padStart(9)}` +
        `${(isBaseline ? "—" : delta(o.atK[5].recall, baseline.overall.atK[5].recall)).padStart(10)}`,
    );
  }
  console.log("  " + "─".repeat(76));
  console.log("");
  console.log(`  Report:   ${resolve(dir, "report.md")}`);
  console.log(`  Failures: ${resolve(dir, "failures.jsonl")}`);
  console.log("");
}

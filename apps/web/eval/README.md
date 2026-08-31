# Retrieval evaluation harness

A reproducible way to answer one question: **when I change chunking, embedding,
or vector search, does retrieval actually get better?**

It indexes a committed corpus with the *production* pipeline, runs a committed
set of questions against it, and scores the results against ground truth that
survives a configuration change. Output is a metrics report comparing
configurations side by side, plus a per-query failure file showing where
retrieval broke and why.

```bash
pnpm eval:run -- --config baseline                      # one configuration
pnpm eval:run -- --config chunk-400 --config chunk-1200 # a comparison
pnpm eval:clean                                         # drop the eval namespaces
pnpm eval:reset -- --dry-run                            # full clean slate, previewed
```

There is a second, complementary answer key: **public BEIR benchmarks**
(`pnpm eval:beir`), whose ground truth is whole documents rather than source
spans. It answers "is this stack competitive by an outside standard?" where the
custom set answers "does it find the passage that answers the question?". Both
run on the same pipeline, cache, and namespace isolation — see
[BEIR.md](BEIR.md).

## What this measures, and what it does not

**Measures:** the combined quality of chunking, embedding, and vector search —
whether the right passage ends up in front of the model.

**Does not measure:**

- **Generation.** Faithfulness, answer relevance, citation correctness, and
  LLM-as-judge scoring are a separate concern and are not implemented. Retrieval
  is the ceiling on all of them, which is exactly why it is worth measuring
  alone: a bad answer might come from a weak generator or from never having been
  shown the right text, and a single end-to-end score cannot tell you which.
  There is a `TODO: generation eval` marker in `lib/report.ts` where it attaches.
- **Correctness of the code.** That is `pnpm test`, which is deterministic,
  needs no secrets, and runs in CI. This harness is neither.

**It is not part of the test suite or CI, by design.** It calls live models,
spends real Workers AI quota, and its results move between runs. Adding it to
`pnpm test` would make the suite slow, flaky, and dependent on secrets. The one
exception is the pure metric math (`lib/metrics.ts`, `lib/relevance.ts`,
`lib/lexical.ts`), which *is* covered by vitest — a metric that silently drifts
returns a plausible number rather than an error, so it needs the safety net most.

## The idea that makes it work: source-span ground truth

The usual way a retrieval benchmark rots is that its answer key names chunk ids.
"Chunk 47 answers question 12" stops being true the moment the chunk size
changes: the id still resolves, it just points at different text now, and every
number computed from it is quietly meaningless. Which makes the benchmark
useless for the single most valuable thing it could do — comparing chunking
strategies.

So ground truth here is anchored to **character offsets in the original
document**:

```jsonc
{
  "id": "en-07",
  "question": "Why do test sets rot when their answer keys point at piece numbers?",
  "documentId": "evaluation-notes",
  "sourceSpan": { "startChar": 2503, "endChar": 2800, "page": null },
  "difficulty": "medium",
  "tags": ["method", "paraphrased"]
}
```

A retrieved chunk is **relevant** when its own source span overlaps the golden
span. Chunk boundaries can then move freely between configurations while the
answer key stays valid.

This only works because chunks know where they came from. `chunkPages()` in
[`src/server/lib/chunking.ts`](../src/server/lib/chunking.ts) records
`startChar`/`endChar` on every chunk, guaranteeing that a chunk is a contiguous
slice of its source page text — an invariant asserted in
[`chunking.test.ts`](../src/server/lib/chunking.test.ts). Ingestion writes those
offsets into vector metadata too, so the property holds in production and not
only in the harness.

Offsets index the **page text**, per page for PDFs and the whole file for
txt/markdown, so a span is only fully identified by `(page, startChar, endChar)`.

### The overlap rule

There is no single correct definition of "this chunk contains the answer", so
the rule is explicit, configurable, and printed in every report.

```ts
{ minOverlapChars: 1, minGoldenCoverage: 0.5, mode: "any" }   // the default
```

Read as: a chunk counts if it overlaps the golden span **at all**, *or* if it
covers **at least half** of it.

- `mode: "any"` asks whether a chunk is **useful** — it holds part of the
  answer, even a fragment. That is generous but defensible: a chunk with the
  tail of the answer is still a retrieval the reader benefits from.
- `mode: "all"` asks whether a chunk is **sufficient** — it holds most of the
  answer by itself.

Both are legitimate. Reporting a number without saying which was used is not.
Override per experiment via `relevance`; the default lives in
[`config.ts`](config.ts).

### Recall here is real recall

`recall@k` is measured against **every chunk in the index that overlaps the
golden span**, including chunks retrieval never returned — not against the
retrieved set. That is knowable only because the harness owns the chunking.

This matters because `hit-rate@k` and `recall@k` get conflated constantly. Hit
rate asks whether the reader could be answered at all; recall asks how much of
the available evidence was surfaced. A configuration can hold hit rate flat
while halving recall, which shows up much later as thinner citations.

## Layout

```
eval/
├── corpus/            Committed source documents (md/txt/pdf)
├── datasets/          Committed golden sets: <name>.jsonl + <name>.meta.json
├── experiments/       Committed configurations, one .ts per experiment
├── lib/               Harness internals (metrics, relevance, cache, runner…)
│   └── beir/          Document-level ground truth: loader, fold, judge, report
├── scripts/           run.ts · gen.ts · beir.ts · clean.ts
├── beir/data/         Downloaded BEIR datasets (git-ignored, optional location)
├── results/           Run output (git-ignored)
├── .cache/            Embedding cache (git-ignored)
├── BEIR.md            The public-benchmark half of the harness
└── config.ts          Every eval-only constant, commented
```

Everything under `corpus/`, `datasets/`, and `experiments/` is committed so a
run is reproducible and a change to any of them shows up in a diff.

## Running experiments

An experiment is a `.ts` file that default-exports a config. Adding one is a
single action — drop a file, run it:

```ts
// eval/experiments/chunk-1200.ts
import { experiment, overlapFor } from "./_base";

export default experiment("Chunk-size sweep: 1200 chars, 15% overlap", {
  chunkSizeChars: 1200,
  chunkOverlapChars: overlapFor(1200),
});
```

`_base.ts` pulls its defaults from `src/server/config.ts`, so "baseline" always
means "what the product does today" rather than a copy that silently goes stale.
Files starting with `_` are helpers, not runnable experiments.

The starter set covers the ablations worth having on day one:

| Experiment | What it isolates |
| --- | --- |
| `baseline` | Production defaults — the comparison point |
| `chunk-400`, `chunk-800`, `chunk-1200` | Chunk size, overlap held at 15% |
| `overlap-0`, `overlap-30` | Overlap, chunk size held at 900 |
| `topk-3`, `topk-20` | topK sensitivity |
| `hybrid` | Dense vs hybrid — **blocked, see below** |

```bash
pnpm eval:run -- --list                    # what is available
pnpm eval:run -- --config a --config b     # compare, baseline = first
pnpm eval:run -- --config a --baseline b   # pick the baseline explicitly
pnpm eval:run -- --config a --force        # re-index instead of reusing
pnpm eval:run -- --config a --yes          # skip the budget prompt
```

### The hybrid ablation cannot run yet

`hybrid.ts` is committed but **fails immediately with an explanation**. The
Workers AI REST endpoint for `@cf/baai/bge-m3` returns dense vectors only. The
model does compute sparse/lexical weights, but they are not exposed, so nothing
sparse was stored at index time and there is nothing to fuse at query time.

It fails rather than quietly running dense and labelling the result "hybrid",
which would be worse than not having the experiment. When sparse vectors become
reachable (see the `TODO: hybrid search` markers in
[`embeddings.ts`](../src/server/services/embeddings.ts) and
[`retrieval.ts`](../src/server/services/retrieval.ts)), that file is the
ablation, unchanged.

Re-ranking is wired the same way: `retrieval.rerank` is a real flag threaded to
a no-op, so a cross-encoder slots in at a marked insertion point.

## Reading a report

Each run writes to `eval/results/<timestamp>-<label>/`:

| File | What it is for |
| --- | --- |
| `metrics.json` | Everything, machine-readable — diff runs over time |
| `report.md` | The deliverable: metrics, deltas vs baseline, caveats |
| `failures.jsonl` | The queries that went wrong, worst first |

`report.md` opens with caveats, because they change how the numbers should be
read — a small dataset, a synthetic unreviewed one, configurations whose chunk
counts differ enough that `precision@k` stops being comparable.

**`failures.jsonl` is the file that makes this actionable.** Each row carries the
question, the golden span's text, every chunk in the index that *should* have
matched, and the top retrieved chunks with scores and relevance flags — so you
can see whether a miss was a bad chunk boundary, a semantic gap, or a case that
needs lexical matching. Each row also carries a `diagnosis`, which distinguishes
a genuine retrieval failure from a **dataset** bug (a golden span matching no
chunk at all). Those are excluded from recall and NDCG rather than blamed on
retrieval.

Metrics reported at k ∈ {1, 3, 5, 10}: `hit-rate@k`, `recall@k`, `precision@k`,
`ndcg@k`, plus MRR, mean/median first-relevant rank, and complete misses — each
broken down by `difficulty` and `tag`.

Results are git-ignored by default. Copy a `report.md` out if you want to keep
one.

## Building a dataset

### By hand

The highest-value items are hand-written. Add a line to
`eval/datasets/<name>.jsonl` following the shape above, and a
`<name>.meta.json` manifest recording provenance. Spans are validated against
the corpus before a run spends anything — a span pointing past the end of its
document, or at a page that does not exist, aborts with the offending item id
rather than silently reporting a recall drop.

The committed `starter` set is 27 hand-written questions over the three corpus
documents, deliberately paraphrased so dense retrieval has to do real work.

### By generation

```bash
pnpm eval:gen -- --name my-set --per-doc 6   # → datasets/my-set.review.jsonl
# ...read it, delete the bad rows, tighten spans...
pnpm eval:gen -- --promote my-set            # → datasets/my-set.jsonl
```

Generation writes a **review queue**, never a dataset. Promotion is a separate,
deliberate step, because synthetic questions fail in a way that makes a harness
look healthy while measuring nothing:

> A model shown a passage and asked for a question reuses the passage's
> vocabulary. The resulting question is retrieved perfectly by every
> configuration, because the words match. A dataset full of them reports ~1.0
> recall for everything and has quietly stopped discriminating.

Three defences, in order of reliability:

1. **Lexical filters.** A candidate is rejected when its content-word Jaccard
   against the source passage exceeds `MAX_QUESTION_PASSAGE_JACCARD` (0.6), or
   when ≥95% of its words appear in the passage. Both signals are used because
   they fail differently: Jaccard catches a question mirroring a short passage,
   coverage catches a short question lifted out of a long one.
2. **Prompting for paraphrase**, across three styles — direct fact, paraphrased,
   multi-clue — tagged and mapped to `easy`/`medium`/`hard` so the report can
   break results down by difficulty. Near-duplicate questions are dropped.
3. **A human.** Rows carry a `review` block with the Jaccard score, the source
   passage, and any flags. The manifest records `humanReviewed`, and the report
   prints a lower-confidence caveat when it is false.

## Cost and quota

Workers AI grants **10,000 Neurons/day**. The harness prices a run *before*
spending anything and stops for confirmation above
`NEURON_BUDGET_PROMPT_THRESHOLD` (2,000 neurons, a fifth of the daily
allowance); `--yes` skips the prompt, and a non-interactive shell is refused
rather than silently approved.

Four things keep the cost near zero:

- **Disk cache** (`eval/.cache/`), keyed by `hash(text + model)`. Chunking
  config is deliberately *not* in the key, so configurations sharing chunk text
  share embeddings.
- **Namespace names hash only what changes the vectors** — corpus, chunking,
  model. Query-time settings are excluded, so a **topK sweep re-embeds nothing
  and re-uses one index**.
- **Existing namespaces are reused** unless `--force`.
- **Batching** at ≤100 inputs/request, with spacing and exponential backoff on
  429/5xx.

Measured on the committed 3-document corpus (~13k characters):

| Run | Cost |
| --- | --- |
| `baseline` alone, cold cache and cold index | ~4 neurons (48 embeddings) |
| All eight starter experiments, fully cold | ~15 neurons (170 embeddings) |
| Any re-run with a warm cache and existing indexes | ~1 neuron (queries only) |

That is **under 0.2% of one day's free allowance for the entire starter sweep**.
Generation is the expensive side: `eval:gen` at 6 passages/document across 3
documents is ~54 completions and lands nearer 300–400 neurons, which is why it
prompts before spending.

A **BEIR** run is the one that costs real quota — NFCorpus is 3,633 documents
against this corpus's three, and indexing it in full is ~1,479 neurons, about
15% of a day. It therefore prompts at a fifth of the threshold used here, and
`pnpm eval:beir -- --dry-run` prices a run without indexing anything. See
[BEIR.md → Cost](BEIR.md#cost-and-the-thing-that-actually-saves-quota).

## Starting from a clean slate

```bash
pnpm eval:reset -- --dry-run          # show exactly what would go, delete nothing
pnpm eval:reset                       # namespaces + results
pnpm eval:reset -- --cache            # ...and the embedding cache (costs quota)
pnpm eval:reset -- --dataset starter  # only one dataset's namespaces
```

A run leaves state in three places, and they are **not** equally dangerous —
which is why `eval:reset` does not simply delete all three:

| State | Can it corrupt a result? | Default |
| --- | --- | --- |
| Pinecone `__eval__:` namespaces | **Yes** | deleted |
| `eval/results/` | No — output only, nothing reads it back | deleted |
| `eval/.cache/` | **No** — keyed by `hash(model + text)` | **kept** |

The namespace is the one that matters, because of a specific failure:
`ensureIndexed` reuses a namespace that already exists, and a run interrupted
partway leaves one holding a *prefix* of the chunks. Scoring against that does
not error — a missing chunk is one fewer competitor for the top-k slots, so a
half-written index reports metrics the configuration never earned.

That is now caught rather than only cleaned up after: `ensureIndexed` compares
the namespace's vector count against the chunk count and rebuilds on a
mismatch. The rebuild is nearly free, because the embedding cache is
content-addressed and already holds those vectors.

Which is also why **the cache is kept by default**. A cache hit returns exactly
the vector the model would have returned for that text, so it cannot make a run
wrong; a truncated shard is already discarded and rebuilt by `EmbeddingCache`.
Deleting it buys no correctness and costs real quota — refilling it for NFCorpus
alone is ~1,479 neurons, about 15% of a day. Pass `--cache` if you want it gone
regardless.

`eval:clean` remains the narrower command: namespaces only, nothing local. Both
share one implementation of the guarded delete in
[`lib/cleanup.ts`](lib/cleanup.ts), so the check protecting tenant data cannot
be right in one script and subtly wrong in the other.

## Isolation from tenant data

The harness shares the app's Pinecone index and writes only to namespaces
prefixed `__eval__:` — BEIR runs included, which is why `eval:clean` finds them
and `eval:clean --dataset beir-nfcorpus` targets only those. Tenant namespaces are `t_{tenantId}__c_{collectionId}` and
cannot collide with it.

`assertEvalNamespace()` guards every destructive operation, and both `eval:clean`
and `eval:reset` re-check each namespace at the moment of deletion, not only when
selecting them. Both print the tenant namespaces they are leaving alone, by name.
There is no flag that makes either of them touch tenant data. The harness never
opens a database connection, reads a tenant document, or touches Vercel Blob.

## Known caveats

**Deleting and immediately re-running races.** Pinecone reports a namespace as
deleted well before the delete has finished propagating. Because namespace names
are a hash of the configuration, the next `eval:run` re-creates the same names —
and a late-arriving delete can empty a namespace *during* the run. Observed in
practice: a `topK 20` run scored 0.04 hit@1 against an index where an identical
`topK 8` run scored 0.74.

`runExperiment` compares the namespace's vector count before and after the query
loop and **aborts rather than reporting** if it changed. Still: after
`eval:clean`, wait a few minutes before the next run. The embedding cache makes
the retry free.

**Latency is context, not a metric.** A cached embedding returns without a
network call, so `embed p50` is only meaningful on a cold cache.

**Small datasets swing.** At 27 questions, one item moving from rank 4 to rank 1
shifts MRR by ~2.8 points. Treat differences below a few points as noise.

**Token counts are estimates.** Budgeting uses `js-tiktoken`'s `cl100k_base`,
not bge-m3's or Llama's own tokenizer — good to a few percent on English prose,
looser on other scripts. It is a spend guard, not an invoice.

## Credentials

Reads the same `apps/web/.env.local` the app uses — there is no eval-specific
credential. `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `PINECONE_API_KEY`,
and `PINECONE_INDEX_HOST` are required, and a missing one fails immediately with
the variable name and where to get it, rather than a 401 partway through a run
that has already spent quota.

The scripts run under `tsx --conditions=react-server`, which is how they can
import modules guarded by `server-only` — the same condition Next.js uses to
resolve that package to an empty module.

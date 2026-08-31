# Benchmarking against BEIR

The harness scores retrieval against **two kinds of ground truth**, because they
answer two different questions and neither one substitutes for the other.

```bash
pnpm eval:run  -- --config baseline    # our golden set: does it find the passage?
pnpm eval:beir -- --dry-run            # BEIR: how do we rank on a public benchmark?
```

| | `eval:run` | `eval:beir` |
| --- | --- | --- |
| Answer key | a character span of a source document | a whole document, with a grade |
| Corpus | 3 committed documents we wrote | 3,633 documents nobody here wrote |
| Questions | 27, hand-written, deliberately paraphrased | 323, from the published split |
| Scored unit | a **chunk** | a **document** |
| Comparable to | our own previous runs | published BEIR / MTEB numbers |
| Answers | "did chunking + embedding surface the right passage?" | "is this stack any good, by an outside standard?" |

The custom set is the one that catches a regression in *our* pipeline on *our*
content, and it survives a chunk-size change because its ground truth is
anchored to source offsets. BEIR is the one that says whether the whole approach
is competitive at all, on a corpus that cannot have been tuned for. Keep both.

## The problem: the answer keys are different shapes

`eval:run` asks "does this chunk overlap the passage that answers the
question?". BEIR cannot be asked that — its answer key names documents and knows
nothing about offsets:

```
query-id   corpus-id   score
PLAIN-2    MED-10      2
PLAIN-2    MED-2429    1
```

So the judgement happens one level up. Retrieval returns a ranking of **chunks**;
that ranking is folded into a ranking of **documents**, each document entering at
the position of its best-scoring chunk, exactly once; and the document ranking is
what every metric scores, using the qrel grade as the relevance gain.

```
chunks          MED-10#0 (.81)  MED-10#2 (.79)  MED-88#1 (.77)  MED-10#1 (.74)
                     |               |               |               |
documents       1. MED-10 (.81, 3 chunks)      2. MED-88 (.77, 1 chunk)
grades              2                              0
```

That fold is the load-bearing step, and it is why chunk-level scoring against
document-level qrels would be wrong rather than merely approximate: a query whose
one relevant document produced five chunks would count as five successes, and
`precision@k` would reward returning the same document over and over.

The fold lives in [`lib/beir/judge.ts`](lib/beir/judge.ts) and is unit-tested in
the ordinary vitest suite — no secrets, no network — for the same reason the
metric math is: a bug there does not throw, it reports a plausible number.

## What the metrics mean here

Everything except MAP comes from the same `aggregate()` the custom harness uses.
Those functions take gains and know nothing about where a gain came from, so
`hit-rate@k`, `precision@k`, `recall@k`, `ndcg@k` and MRR mean exactly what they
mean elsewhere — only the unit being counted changes from a chunk to a document.

- **nDCG@10** is BEIR's headline. Gains are **linear** (`gain = qrel grade`),
  which is what trec_eval's `ndcg_cut` computes and therefore what every
  published BEIR number is. The existing `dcgAtK` already does this, so no
  second definition of NDCG exists in the repo.
- **recall@k** is the fraction of a query's judged-relevant documents that reach
  the top k. NFCorpus averages **38.2 relevant documents per test query**, but
  the distribution is heavily skewed (median 16, max 475) — so the ceiling is
  *not* `k / 38.2`. Recall is averaged per query, which makes the real ceiling
  the mean of `min(k, R) / R`:

  | k | 1 | 3 | 5 | 10 | 20 | 100 |
  | --- | ---: | ---: | ---: | ---: | ---: | ---: |
  | max possible recall@k | 0.179 | 0.359 | 0.462 | 0.615 | 0.768 | 0.965 |

  Read a recall number against that row, not against 1.0. A perfect retriever
  scores 0.615 at k=10, not 1.0, because ten slots cannot hold sixteen
  documents.
- **MAP@k** normalizes by the *total* number of relevant documents rather than
  by k, matching `map_cut`, and binarizes graded qrels as trec_eval does. It
  lives in [`lib/beir/metrics.ts`](lib/beir/metrics.ts) rather than in the shared
  metric module, so adding it did not change the shape of any `metrics.json` the
  custom harness has already written.

## Retrieval depth is not topK

```
--depth 250   # chunks fetched per query, before folding
```

This is deliberately not the product's `TOP_K` of 8, and it is named differently
to keep the two from being confused. A document ranking deep enough to measure
`recall@100` needs materially more than 100 chunks behind it, because several
retrieved chunks routinely come from the same document. The report prints the
ratio it actually measured (`Chunks per distinct document`) rather than assuming
one — it depends on the corpus, the chunk size, and how much the model clusters
a document's chunks together.

Two things make this cheap and safe:

- **Depth costs no embedding quota.** It is a query-time parameter, so changing
  it re-embeds nothing and reuses the same index.
- **Folding is order-preserving**, so one run at depth 250 reports the correct
  number at *every* cutoff. There is no need for a run per cutoff.

The report prints how deep the rankings actually went, and raises a caveat when
any query ranked fewer documents than the largest cutoff — because a metric at a
cutoff past the end of the ranking is an underestimate, and a silent one.

## Cost, and the thing that actually saves quota

The full NFCorpus test split, at production chunking:

| Run | Chunks | Cost |
| --- | ---: | ---: |
| Full corpus, all 323 queries, cold cache | 9,179 | **~1,479 neurons** (14.8% of a day) |
| The same run again, warm cache | 9,179 | ~0 |
| Whole-document (`--chunk-size 12000 --chunk-overlap 0`) | 3,633 | ~1,324 neurons |
| `--queries 25 --max-docs 1500` | 3,790 | ~609 neurons |

Check before you spend, always:

```bash
pnpm eval:beir -- --dry-run                    # prices it, indexes nothing
```

A BEIR run prompts for confirmation above **500 neurons** — a fifth of the
threshold `eval:run` uses. That is deliberate: a BEIR corpus is three orders of
magnitude larger than the committed one, so a full index is a material slice of
the day's allowance and a four-config chunk sweep would spend the entire day.
`--yes` skips the prompt; a non-interactive shell is refused rather than
silently approved.

**The corpus is the only real cost.** All 323 queries together are ~3 neurons, so
`--queries` saves essentially nothing on quota — it saves *time*. The lever that
saves quota is `--max-docs`, and it is the one with a price:

> `--max-docs` keeps every judged document and fills the remainder with random
> distractors, so the answer key stays intact — but a smaller haystack means
> fewer things to rank above the right one, and **every metric is inflated**.
> A pooled run compares configurations against each other. It cannot be compared
> to a published number, and the report says so instead of letting someone
> assume otherwise.

Refusing to drop a judged document is why `--max-docs` sometimes errors: on
NFCorpus even 30 queries are judged against 987 distinct documents, so the qrels
are dense enough that pooling buys less than it looks like it should. Running the
full corpus once and letting the cache absorb every later run is usually the
better trade.

## Running it

```bash
pnpm eval:beir -- --list                        # datasets on the search path
pnpm eval:beir -- --dry-run                     # price it, spend nothing
pnpm eval:beir                                  # full nfcorpus test split
pnpm eval:beir -- --queries 50                  # a faster, noisier sample
pnpm eval:beir -- --max-docs 1500 --queries 25  # cheap smoke test (inflated)
pnpm eval:beir -- --chunk-size 400              # a chunking ablation
pnpm eval:beir -- --chunk-size 12000 --chunk-overlap 0   # no chunking at all
pnpm eval:clean -- --dataset beir-nfcorpus      # drop just these namespaces
```

| Flag | |
| --- | --- |
| `--dataset <name>` | BEIR dataset name. Default `nfcorpus`. |
| `--data <path>` | Explicit dataset directory, overriding the search path. |
| `--split <name>` | `train` \| `dev` \| `test`. Default `test`. |
| `--queries <n>` | Seeded sample of N queries. |
| `--max-docs <n>` | Cap the indexed corpus. Inflates every metric — see above. |
| `--seed <n>` | Sampling seed. Default 1. |
| `--depth <n>` | Chunks retrieved per query. Default 250. Free. |
| `--chunk-size <n>`, `--chunk-overlap <n>` | Default to the product's values. |
| `--dry-run` | Price it and stop. |
| `--force` | Re-index instead of reusing the namespace. |
| `--yes` | Skip the budget prompt. |

### Getting a dataset

BEIR datasets are **not committed** — they are ~9 MB of third-party corpus each,
published and versioned upstream, so a run is reproduced by naming the dataset
and checking the corpus fingerprint the report prints, not by vendoring the
files. Unzip a download into either search root:

```
apps/web/eval/beir/data/<name>/     # or the repository root: <repo>/<name>/
  corpus.jsonl
  queries.jsonl
  qrels/{train,dev,test}.tsv
```

`$BEIR_DATA_DIR` and `--data <path>` both override the search. Every BEIR dataset
ships this same three-file shape, which is why one loader covers SciFact, FiQA
and the rest without a special case — but only NFCorpus has been exercised here.

## Reading the report

`eval/results/<timestamp>-beir-<name>-<split>/` gets the same three artifacts as
a custom run: `metrics.json`, `report.md`, `failures.jsonl`.

`report.md` leads with caveats, because a BEIR number is only meaningful next to
a statement of what was indexed. It prints published reference points — BM25 on
NFCorpus is nDCG@10 0.325 in the BEIR paper — **only when the run is actually
comparable**, meaning full corpus and full query set. A sampled run gets an
explicit "suppressed, and here is why" instead of a comparison that would
flatter it.

`failures.jsonl` is ranked by nDCG@10 ascending, so its head is where the
headline number came from. Each row carries both halves of a failure: the
documents that ranked highest with their grades — so a "failure" that retrieved
only *unjudged* documents is visible as such, which on a sparsely judged
benchmark is a real and common case — and the judged documents that never
appeared at all, worst grade first.

## What this does not measure

The same things `eval:run` does not: generation, faithfulness, citation
correctness. BEIR is a retrieval benchmark and this is a retrieval harness.

It also does not make the custom golden set redundant. A public benchmark tells
you how a stack ranks on someone else's medical-abstract corpus; it says nothing
about whether *your* chunking works on *your* documents, and its document-level
answer key structurally cannot detect a chunk boundary that splits an answer in
half. That is exactly what the span-anchored set is for.

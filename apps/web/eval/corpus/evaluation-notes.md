# Notes on Evaluating Retrieval

## What a metric is for

A retrieval metric exists to answer one question: did the system put the right
evidence in front of the reader? Everything else — latency, index size, cost —
is a constraint, not a measure of quality. Confusing the two produces systems
that are fast and cheap at being wrong.

## Hit rate is not recall

These two are conflated constantly, and the difference matters. Hit rate at k
asks whether at least one relevant passage appeared in the top k results. Recall
at k asks what fraction of all the relevant passages appeared there.

A configuration can hold hit rate perfectly flat while halving recall. The user
still gets an answer to every question, so nothing looks broken, but each answer
now rests on half the supporting evidence it used to have. That shows up much
later as thinner citations and more hedging, and by then the change that caused
it is many commits in the past.

Recall is only computable when you know how many relevant passages exist. That
requires ground truth over the whole corpus, not merely over what was retrieved,
which is precisely why a benchmark must own its own chunking rather than measure
against whatever happens to be in a production index.

## Mean reciprocal rank

Mean reciprocal rank averages one over the position of the first relevant
result. A hit at rank one contributes 1.0, at rank two 0.5, at rank four 0.25.
Queries that returned nothing relevant contribute zero.

Its virtue is that it punishes burial. A configuration that finds the right
passage but ranks it eighth scores 0.125, while one that ranks it first scores
1.0, even though hit rate at ten calls both a success. Its limitation is that it
ignores everything after the first hit, so it says nothing about whether the
remaining context was useful.

## Normalised discounted cumulative gain

NDCG discounts each result by the logarithm of its rank and normalises against
the best ordering that was actually possible. It is the metric to reach for when
relevance is graded rather than binary, or when the full ordering matters rather
than just the first hit.

The normalisation is the subtle part. The denominator must be built from every
relevant passage that exists, not from a re-sorting of the passages that were
returned. Normalising against the returned set scores a run that found one of
five relevant passages, and ranked it first, as a flawless 1.0 — which is
exactly backwards.

## Ground truth that survives a config change

The most common way a retrieval benchmark goes stale is that its ground truth
names chunk identifiers. Chunk 47 of a document means nothing once the chunk
size changes; the identifiers still resolve, but they now point at different
text, and every metric computed from them is quietly meaningless.

Anchoring ground truth to character offsets in the original document fixes this.
A golden item records where the answer lives in the source, and a retrieved
chunk is judged relevant when its own source span overlaps that region. Chunk
boundaries can then move freely — which is the entire point, since comparing
chunking strategies is the most valuable thing such a benchmark does.

The overlap rule has to be stated explicitly, because there is no single correct
choice. Counting any overlap at all treats a chunk holding the tail of an answer
as a success, which is generous but defensible: it is still a useful retrieval.
Requiring the chunk to cover most of the golden span instead measures whether a
single chunk is self-sufficient. Both are legitimate; reporting a number without
saying which one was used is not.

## Synthetic questions and their trap

Generating questions with a language model is the only practical way to bootstrap
a dataset, and it has one dangerous failure mode. A model shown a passage and
asked for a question tends to reuse the passage's vocabulary. The resulting
question is retrieved perfectly by every configuration, because the words match.

A benchmark full of such questions reports near-perfect scores for everything and
has quietly stopped discriminating. It looks healthy — the tests pass, the
numbers are high — while measuring nothing at all. The defences are to reject
candidates whose wording overlaps the source passage too heavily, to prompt
explicitly for paraphrase, and to keep a human in the loop before promoting
generated items into a dataset anyone trusts.

## Sample size

Small datasets produce large swings. With thirty questions, a single item moving
from rank four to rank one shifts mean reciprocal rank by about two and a half
points, which is easily mistaken for a real improvement. Treat differences below
a few points on a small set as noise, and grow the set before acting on them.

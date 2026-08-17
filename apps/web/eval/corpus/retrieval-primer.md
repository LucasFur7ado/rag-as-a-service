# A Short Primer on Retrieval

## Why retrieval exists

A language model answers from two sources: what it absorbed during training, and
what you put in front of it at request time. The first is fixed, undated, and
impossible to audit. The second is yours to control. Retrieval-augmented
generation is the discipline of controlling it well.

The bargain is simple. Instead of asking a model what it remembers, you find the
passages that answer the question and instruct the model to use only those. When
it works, the answer is current, attributable, and refusable — the model can say
"I don't know" because you can tell whether the evidence was there.

## The retrieval stage is the ceiling

Everything downstream of retrieval is bounded by it. A generator cannot cite a
passage that was never fetched, and no amount of prompt engineering recovers an
answer that is absent from the context window. This is why retrieval quality is
worth measuring on its own, separately from answer quality: a system that
answers badly might have a weak generator, or it might simply never have been
shown the right text, and those two failures have nothing in common.

Measuring them together hides this. A single end-to-end score that drops after a
change tells you something broke without telling you which half.

## Chunking is a lossy decision

Documents arrive as continuous prose. Vector search operates on fixed units. The
step between them — chunking — is where most retrieval quality is won or lost,
and it is irreversible: once a document is split, the retriever can only ever
return the pieces you made.

Two failure modes bracket the choice. Chunks that are too large bury a
one-sentence answer inside several hundred words of unrelated text, which dilutes
the embedding and wastes the context budget on filler. Chunks that are too small
split an answer across a boundary, so neither half is a convincing match for the
question and both rank below passages that are merely on-topic.

Overlap softens the second failure. By repeating the tail of each chunk at the
head of the next, an answer that straddles a boundary appears whole in at least
one chunk. The cost is duplication: a 30% overlap means roughly 30% more vectors,
more storage, and more near-identical results competing for the same top-k slots.

## Dense retrieval and what it misses

A dense retriever embeds the question and the passages into the same vector
space and returns the nearest neighbours by cosine similarity. Its strength is
paraphrase: a question asking about "refund windows" retrieves a passage about
"the period during which purchases may be returned" without sharing a single
content word.

Its weakness is the mirror image. Dense retrieval is poor at exact tokens —
product codes, error identifiers, surnames, version numbers — because such
strings carry little semantic weight and land near everything and nothing. A
lexical index like BM25 handles these easily. Hybrid search fuses the two result
lists, usually by reciprocal rank fusion, and is the standard remedy.

## Lost in the middle

Long contexts are not read uniformly. Models attend most reliably to the start
and the end of the window and least reliably to the middle, a pattern robust
enough that it has a name: lost in the middle. The practical consequence is that
ranking still matters after retrieval, at the point where passages are laid out
in the prompt.

The usual mitigation is to place the highest-scoring passages at both ends of
the context and bury the weakest in the middle. Citation markers should be
assigned by relevance rank before this reordering, so that marker numbers stay
meaningful to a reader regardless of where a passage physically sits.

## Re-ranking

Retrieval is optimised for speed over a large corpus, which forces a
compromise: the question and the passage are embedded independently, so the
model never sees them together. A cross-encoder re-ranker removes that
compromise for a small number of candidates, scoring each question-passage pair
jointly.

The cost is latency, and it is not small — a cross-encoder runs a full forward
pass per candidate. The usual arrangement is therefore a funnel: retrieve twenty
candidates cheaply, re-rank them, keep the best five. Re-ranking pays off
exactly when recall at a wide k is much better than recall at a narrow k, since
that gap is the evidence that the right passage is being found but not ranked
highly enough.

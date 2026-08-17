import { existsSync, readFileSync } from "node:fs";
import { WorkersAiLlmProvider } from "../../src/server/services/llm";
import { GENERATION_MODEL } from "../../src/server/config";
import {
  CORPUS_DIR,
  GEN_PASSAGE_CHARS,
  GEN_TEMPERATURE,
  MAX_QUESTION_PASSAGE_JACCARD,
  MAX_QUESTION_QUESTION_JACCARD,
} from "../config";
import { loadEnvFiles, requireCredentials } from "../lib/bootstrap";
import { confirmBudget, estimateNeurons, tokensIn } from "../lib/budget";
import { fail, parseArgs } from "../lib/cli";
import { loadCorpus, type CorpusDocument } from "../lib/corpus";
import { reviewQueuePath, validateAgainstCorpus, writeDataset, writeJsonl } from "../lib/dataset";
import { isNearDuplicate, questionCoverage, wordJaccard } from "../lib/lexical";
import { withRetries } from "../lib/retry";
import {
  goldenItemSchema,
  reviewCandidateSchema,
  type DatasetManifest,
  type Difficulty,
  type GoldenItem,
  type ReviewCandidate,
} from "../lib/types";

/**
 * `pnpm eval:gen -- --name <dataset> [--per-doc 6]`
 *
 * Generates candidate questions from the corpus and writes them to a REVIEW
 * QUEUE, not to a dataset. Promotion is a second, deliberate step
 * (`--promote <name>`) after a human has pruned the file.
 *
 * That split is the point. Synthetic questions are cheap and are the only way
 * to get a dataset off the ground, but they fail in ways that make a harness
 * *look* healthy: a question that copies its passage's wording is retrieved
 * perfectly by everything, so a dataset of those reports ~1.0 recall for every
 * configuration and silently stops discriminating. The filters below catch the
 * worst of that automatically; the review queue is what catches the rest.
 *
 * Flags:
 *   --name <dataset>   Dataset name to generate for. Required.
 *   --per-doc <n>      Passages sampled per document (default 6).
 *   --promote <name>   Promote a curated `<name>.review.jsonl` to `<name>.jsonl`.
 *   --yes              Skip the budget confirmation prompt.
 */

/** The three question styles, and the difficulty each maps to. */
const STYLES = [
  {
    id: "direct",
    difficulty: "easy" as Difficulty,
    tag: "direct-fact",
    instruction:
      "Ask a direct factual question whose answer is stated explicitly in the passage. " +
      "Use different words from the passage wherever you can.",
  },
  {
    id: "paraphrased",
    difficulty: "medium" as Difficulty,
    tag: "paraphrased",
    instruction:
      "Ask a question that paraphrases the passage's idea. Deliberately AVOID the passage's " +
      "distinctive nouns and phrasing — describe the concept in your own words instead.",
  },
  {
    id: "multi-clue",
    difficulty: "hard" as Difficulty,
    tag: "multi-clue",
    instruction:
      "Ask a question that can only be answered by combining two or more separate details from " +
      "the passage. Do not reuse the passage's phrasing.",
  },
] as const;

const SYSTEM_PROMPT = `You write evaluation questions for a document retrieval benchmark.

Given a passage, you write ONE question that the passage answers.

Rules:
1. The passage must fully answer the question. Never ask about something it does not say.
2. Write the question as a real user would ask it, without having seen the passage. Never write
   "according to the passage" or "in this text".
3. Avoid reusing the passage's exact wording. A question that copies the passage's keywords is
   useless for benchmarking retrieval.
4. One sentence. No preamble.
5. Reply with JSON only: {"question": "...", "answer": "..."} where answer is a short quote or
   summary of the answering sentence.`;

interface Passage {
  documentId: string;
  page: number | null;
  startChar: number;
  endChar: number;
  text: string;
}

/**
 * Sample passages on paragraph boundaries.
 *
 * Boundaries matter more than they look: a passage cut mid-sentence produces a
 * question about half a fact, and the golden span then points at text that does
 * not actually contain the answer.
 */
function samplePassages(doc: CorpusDocument, perDoc: number): Passage[] {
  const passages: Passage[] = [];

  for (const page of doc.pages) {
    const text = page.text;
    // Paragraph offsets, retained so the golden span indexes the ORIGINAL text.
    const paragraphs: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const part of text.split(/\n\s*\n/)) {
      const start = text.indexOf(part, cursor);
      if (start !== -1 && part.trim().length > 0) {
        paragraphs.push({ start, end: start + part.length });
        cursor = start + part.length;
      }
    }

    // Merge consecutive paragraphs until the target size is reached, so a
    // passage is always a whole number of paragraphs.
    let i = 0;
    while (i < paragraphs.length) {
      const start = paragraphs[i].start;
      let end = paragraphs[i].end;
      let j = i;
      while (end - start < GEN_PASSAGE_CHARS && j + 1 < paragraphs.length) {
        j++;
        end = paragraphs[j].end;
      }
      const slice = text.slice(start, end);
      // Too short to contain a self-contained fact — skip rather than generate
      // a question no chunk can satisfy.
      if (slice.trim().length >= 200) {
        passages.push({ documentId: doc.documentId, page: page.page, startChar: start, endChar: end, text: slice });
      }
      i = j + 1;
    }
  }

  // Spread the sample across the document instead of taking the first N.
  if (passages.length <= perDoc) return passages;
  const step = passages.length / perDoc;
  return Array.from({ length: perDoc }, (_, n) => passages[Math.floor(n * step)]);
}

function parseModelJson(raw: string): { question: string; answer?: string } | null {
  // Models wrap JSON in prose or fences often enough that this is not optional.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { question?: unknown; answer?: unknown };
    if (typeof parsed.question !== "string" || !parsed.question.trim()) return null;
    return {
      question: parsed.question.trim(),
      answer: typeof parsed.answer === "string" ? parsed.answer.trim() : undefined,
    };
  } catch {
    return null;
  }
}

async function generate(args: ReturnType<typeof parseArgs>): Promise<void> {
  const name = args.value("name");
  if (!name) throw new Error("Pass --name <dataset> to say what this dataset is called.");
  const perDoc = Number(args.value("per-doc", "6"));
  if (!Number.isFinite(perDoc) || perDoc <= 0) throw new Error("--per-doc must be a positive number.");

  requireCredentials({ ai: true, vectors: false });

  const documents = await loadCorpus(CORPUS_DIR);
  const passages = documents.flatMap((doc) => samplePassages(doc, perDoc));
  if (passages.length === 0) {
    throw new Error(`No passages of usable length found in ${CORPUS_DIR}.`);
  }

  const attempts = passages.length * STYLES.length;
  console.log(`\n  Corpus:   ${documents.length} documents`);
  console.log(`  Passages: ${passages.length} (${perDoc}/document)`);
  console.log(`  Attempts: ${attempts} (${STYLES.length} styles per passage)\n`);

  // Generation, not embedding, is what burns the daily allowance — price it.
  const promptTokens = tokensIn(passages.flatMap((p) => STYLES.map(() => `${SYSTEM_PROMPT}\n${p.text}`)));
  await confirmBudget([estimateNeurons(GENERATION_MODEL, promptTokens, attempts * 80)], {
    yes: args.flag("yes"),
  });

  const llm = new WorkersAiLlmProvider();
  const candidates: ReviewCandidate[] = [];
  const acceptedQuestions: string[] = [];
  const rejected = { unparseable: 0, copied: 0, duplicate: 0 };

  for (const [index, passage] of passages.entries()) {
    for (const style of STYLES) {
      const id = `${passage.documentId}-${passage.startChar}-${style.id}`;

      let completion: string;
      try {
        const result = await withRetries(`generate ${id}`, () =>
          llm.complete({
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: `${style.instruction}\n\nPassage:\n"""\n${passage.text}\n"""` },
            ],
            temperature: GEN_TEMPERATURE,
            maxTokens: 200,
          }),
        );
        completion = result.text;
      } catch (err) {
        console.warn(`    ! ${id}: generation failed — ${err instanceof Error ? err.message : err}`);
        rejected.unparseable++;
        continue;
      }

      const parsed = parseModelJson(completion);
      if (!parsed) {
        rejected.unparseable++;
        continue;
      }

      // --- Quality gates ----------------------------------------------------
      const jaccard = wordJaccard(parsed.question, passage.text);
      const coverage = questionCoverage(parsed.question, passage.text);

      // Either signal alone is enough to disqualify: Jaccard catches a question
      // that mirrors a short passage, coverage catches a short question lifted
      // out of a long one.
      if (jaccard >= MAX_QUESTION_PASSAGE_JACCARD || coverage >= 0.95) {
        rejected.copied++;
        continue;
      }
      if (isNearDuplicate(parsed.question, acceptedQuestions, MAX_QUESTION_QUESTION_JACCARD)) {
        rejected.duplicate++;
        continue;
      }

      const flags: string[] = [];
      if (coverage >= 0.75) flags.push(`high lexical overlap with the passage (coverage ${coverage.toFixed(2)})`);
      if (parsed.question.length < 25) flags.push("very short question — may be under-specified");
      if (/passage|text|document|above/i.test(parsed.question)) {
        flags.push("refers to the passage itself — rewrite as a standalone question");
      }

      acceptedQuestions.push(parsed.question);
      candidates.push(
        reviewCandidateSchema.parse({
          id,
          question: parsed.question,
          documentId: passage.documentId,
          sourceSpan: { startChar: passage.startChar, endChar: passage.endChar, page: passage.page },
          answerText: parsed.answer,
          difficulty: style.difficulty,
          tags: [style.tag, `doc:${passage.documentId}`],
          review: { questionPassageJaccard: Number(jaccard.toFixed(3)), flags, passageText: passage.text },
        }),
      );
    }
    console.log(`    passage ${index + 1}/${passages.length} — ${candidates.length} candidates kept`);
  }

  const path = reviewQueuePath(name);
  writeJsonl(path, candidates);

  console.log(`\n  Kept ${candidates.length} of ${attempts} candidates.`);
  console.log(`    rejected — copied wording: ${rejected.copied}`);
  console.log(`    rejected — near-duplicate: ${rejected.duplicate}`);
  console.log(`    rejected — unusable output: ${rejected.unparseable}`);
  console.log(`  Flagged for attention: ${candidates.filter((c) => c.review.flags.length > 0).length}`);
  console.log(`\n  Review queue: ${path}`);
  console.log(
    `\n  Next: read that file, delete the bad rows and tighten any span that does not contain the\n` +
      `  answer, then promote it:\n\n      pnpm eval:gen -- --promote ${name}\n`,
  );
}

/** Turn a curated review queue into a dataset. */
async function promote(name: string): Promise<void> {
  const path = reviewQueuePath(name);
  if (!existsSync(path)) throw new Error(`No review queue at ${path}. Generate one first.`);

  const items: GoldenItem[] = [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Drop the `review` block — it is scaffolding for the human, not ground truth.
    const candidate = JSON.parse(line) as ReviewCandidate;
    const item: Record<string, unknown> = { ...candidate };
    delete item.review;
    try {
      items.push(goldenItemSchema.parse(item));
    } catch (err) {
      throw new Error(`${path}:${i + 1} is not a valid item — ${err instanceof Error ? err.message : err}`);
    }
  }
  if (items.length === 0) throw new Error(`${path} has no items left after curation.`);

  // Spans are re-validated here, not only at run time: promotion is the last
  // point before these numbers start being trusted.
  const documents = await loadCorpus(CORPUS_DIR);
  const problems = validateAgainstCorpus(items, documents);
  if (problems.length > 0) {
    throw new Error(`The curated file does not line up with the corpus:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }

  const manifest: DatasetManifest = {
    name,
    description: `Questions generated from the ${documents.length}-document reference corpus and curated by hand.`,
    itemCount: items.length,
    createdAt: new Date().toISOString(),
    corpus: documents.map((d) => d.filename).join(", "),
    provenance: "synthetic",
    generatorModel: GENERATION_MODEL,
    // The whole purpose of the promote step. If you automate around it, set
    // this honestly — the report prints a lower-confidence caveat when false.
    humanReviewed: true,
    notes: "Promoted from a review queue. Spans validated against the corpus at promotion time.",
  };

  writeDataset(name, items, manifest);
  console.log(`\n  ✓ Promoted ${items.length} items to eval/datasets/${name}.jsonl`);
  console.log(`    Manifest written to eval/datasets/${name}.meta.json\n`);
}

async function main(): Promise<void> {
  loadEnvFiles();
  const args = parseArgs();

  const toPromote = args.value("promote");
  if (toPromote) return promote(toPromote);
  return generate(args);
}

main().catch(fail);

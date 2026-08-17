import { createHash } from "node:crypto";
import { EVAL_NAMESPACE_PREFIX } from "../config";
import type { ResolvedExperiment } from "./types";

/**
 * Naming and isolation for the harness's Pinecone namespaces.
 *
 * Two separate identities matter here, and conflating them is expensive:
 *
 * - The **index hash** covers only what changes the vectors in the index — the
 *   corpus, the chunking configuration, and the embedding model. It names the
 *   namespace.
 * - The **config hash** additionally covers query-time settings (topK, the
 *   threshold, the relevance rule). It names the *run*.
 *
 * Keeping topK out of the namespace is what makes a topK sweep nearly free: all
 * four cutoffs query one index instead of re-embedding the whole corpus four
 * times. The chunk-size sweep, by contrast, genuinely changes the vectors and
 * correctly gets a namespace each.
 */

function shortHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 10);
}

/** Identity of what is stored in the index. */
export function indexHash(experiment: ResolvedExperiment, corpusFingerprint: string): string {
  return shortHash({
    corpus: corpusFingerprint,
    chunking: experiment.chunking,
    model: experiment.embeddingModel,
  });
}

/** Identity of a whole run, index plus query-time settings. */
export function configHash(experiment: ResolvedExperiment, corpusFingerprint: string): string {
  return shortHash({
    index: indexHash(experiment, corpusFingerprint),
    retrieval: experiment.retrieval,
    relevance: experiment.relevance,
    dataset: experiment.dataset,
  });
}

/**
 * Content fingerprint of the corpus, so editing a corpus file invalidates the
 * index that was built from it instead of silently scoring stale vectors.
 */
export function fingerprintCorpus(documents: { documentId: string; pages: { text: string }[] }[]): string {
  return shortHash(
    documents.map((doc) => [doc.documentId, doc.pages.map((p) => p.text.length), shortHash(doc.pages.map((p) => p.text))]),
  );
}

/** The namespace an experiment indexes into. */
export function evalNamespace(experiment: ResolvedExperiment, corpusFingerprint: string): string {
  return `${EVAL_NAMESPACE_PREFIX}:${experiment.dataset}:${indexHash(experiment, corpusFingerprint)}`;
}

/**
 * Guard every destructive operation. The harness shares a Pinecone index with
 * real tenant data, whose namespaces are `t_{tenantId}__c_{collectionId}` — so
 * "does it start with `__eval__`" is the one check standing between a cleanup
 * command and someone's documents.
 */
export function isEvalNamespace(namespace: string): boolean {
  return namespace.startsWith(`${EVAL_NAMESPACE_PREFIX}:`);
}

/** Throw unless `namespace` is one of ours. Called before any delete. */
export function assertEvalNamespace(namespace: string): void {
  if (!isEvalNamespace(namespace)) {
    throw new Error(
      `Refusing to operate on "${namespace}": it is not an evaluation namespace ` +
        `(must start with "${EVAL_NAMESPACE_PREFIX}:"). This guard is what keeps the harness away from tenant data.`,
    );
  }
}

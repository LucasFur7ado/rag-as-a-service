import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { CACHE_DIR, EVAL_NAMESPACE_PREFIX, EVAL_ROOT, RESULTS_DIR } from "../config";
import type { VectorStore } from "../../src/server/services/vectorstore";
import { waitForNamespaceGone } from "./indexer";
import { assertEvalNamespace, isEvalNamespace } from "./namespace";
import { withRetries } from "./retry";

/**
 * The destructive operations, in one place.
 *
 * `eval:clean` and `eval:reset` both delete things, and one of those things is
 * a namespace in a Pinecone index that also holds real tenant documents. There
 * is exactly one implementation of that delete, here, so the guard protecting
 * it cannot be correct in one script and subtly wrong in the other.
 *
 * Two separate guards, because the two kinds of target fail differently:
 *
 * - Namespaces are checked against {@link isEvalNamespace} when selected and
 *   again by {@link assertEvalNamespace} at the moment of deletion. Tenant
 *   namespaces are `t_{tenantId}__c_{collectionId}`; the prefix check is the
 *   only thing standing between a cleanup command and someone's documents.
 * - Directories are checked to live under `eval/`, so a mistaken path can
 *   delete a run artifact and nothing else.
 */

// --- Vector namespaces ------------------------------------------------------

export interface NamespaceSelection {
  /** Evaluation namespaces matching the filter — safe to delete. */
  targets: string[];
  /** Namespaces that are NOT ours. Never touched; reported for reassurance. */
  protectedNamespaces: string[];
  /**
   * Every namespace in the index. Not `targets + protectedNamespaces`: with a
   * `--dataset` filter those two exclude the harness's OTHER datasets, and
   * reporting their sum as the index total would understate what is there.
   */
  total: number;
  /** Vector count per namespace, as the index reported it. */
  counts: Record<string, number>;
}

/**
 * Find the harness's namespaces, optionally narrowed to one dataset.
 *
 * `dataset` matches the middle segment of `__eval__:<dataset>:<hash>` — so
 * `starter` selects the custom golden-set indexes and `beir-nfcorpus` selects
 * the BEIR ones, and neither can select the other.
 */
export async function selectEvalNamespaces(
  store: VectorStore,
  dataset?: string,
): Promise<NamespaceSelection> {
  const counts = await withRetries("read index stats", () => store.namespaceStats());
  const all = Object.keys(counts);
  const ours = all.filter(isEvalNamespace);

  return {
    targets: ours
      .filter((ns) => !dataset || ns.startsWith(`${EVAL_NAMESPACE_PREFIX}:${dataset}:`))
      .sort(),
    protectedNamespaces: all.filter((ns) => !isEvalNamespace(ns)).sort(),
    total: all.length,
    counts,
  };
}

/**
 * Delete evaluation namespaces and wait for the deletes to drain.
 *
 * Every name is re-asserted at the point of deletion, not only when it was
 * selected: the two happen at different times, and the check that matters is
 * the one immediately before the destructive call.
 */
export async function deleteEvalNamespaces(
  store: VectorStore,
  namespaces: string[],
  log: (message: string) => void = () => {},
): Promise<void> {
  for (const namespace of namespaces) {
    assertEvalNamespace(namespace);
    await withRetries(`delete ${namespace}`, () => store.deleteNamespace(namespace));
    log(`✓ deleted ${namespace}`);
  }

  if (namespaces.length === 0) return;
  log("waiting for deletions to propagate…");
  for (const namespace of namespaces) {
    await waitForNamespaceGone(store, namespace, log);
  }
}

// --- Local directories ------------------------------------------------------

/** What a directory holds, for showing before deleting it. */
export interface DirectorySummary {
  path: string;
  exists: boolean;
  entries: number;
  bytes: number;
}

export function summarizeDirectory(dir: string): DirectorySummary {
  if (!existsSync(dir)) return { path: dir, exists: false, entries: 0, bytes: 0 };

  let entries = 0;
  let bytes = 0;
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      entries++;
      try {
        bytes += statSync(path).size;
      } catch {
        // A file that vanished between readdir and stat is not worth failing a
        // size estimate over.
      }
    }
  };
  walk(dir);
  return { path: dir, exists: true, entries, bytes };
}

/**
 * Delete a directory that belongs to the harness.
 *
 * Refuses anything outside `eval/`. This function is handed paths from config
 * rather than from user input today, but it is the one place in the harness
 * that recursively deletes a directory, and a guard costs nothing.
 */
export function removeEvalDirectory(dir: string): void {
  const target = resolve(dir);
  const root = resolve(EVAL_ROOT);
  if (target !== root && !target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) {
    throw new Error(
      `Refusing to delete "${target}": it is not inside the evaluation harness (${root}).`,
    );
  }
  if (target === root) {
    throw new Error(`Refusing to delete the harness itself (${root}).`);
  }
  rmSync(target, { recursive: true, force: true });
}

/** Human-readable byte size for the confirmation prompt. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The two local directories a run writes to. */
export const LOCAL_STATE = {
  cache: CACHE_DIR,
  results: RESULTS_DIR,
} as const;

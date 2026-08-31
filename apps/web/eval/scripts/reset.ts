import { createInterface } from "node:readline/promises";
import { PineconeVectorStore } from "../../src/server/services/vectorstore";
import { loadEnvFiles, requireCredentials } from "../lib/bootstrap";
import { fail, parseArgs } from "../lib/cli";
import {
  LOCAL_STATE,
  deleteEvalNamespaces,
  formatBytes,
  removeEvalDirectory,
  selectEvalNamespaces,
  summarizeDirectory,
} from "../lib/cleanup";

/**
 * `pnpm eval:reset [-- --dataset <name>] [--cache] [--dry-run] [--yes]`
 *
 * Puts the harness back to a clean slate, so the next run measures what it
 * indexes and nothing left over from a previous one.
 *
 * There are exactly three places a run leaves state, and they are NOT equally
 * dangerous — which is why this does not simply delete all three:
 *
 *   1. Pinecone `__eval__:` namespaces.  THE ONE THAT CAN CORRUPT A RESULT.
 *      A namespace is reused when it already exists, so an index left partial
 *      by an interrupted run gets scored as if it were complete. Cleared by
 *      default.
 *
 *   2. eval/results/.  Output artifacts only — nothing reads them back. Stale
 *      reports cannot change a number, they can only be confused for a current
 *      one. Cleared by default.
 *
 *   3. eval/.cache/.  The embedding cache, keyed by hash(model + text).
 *      CANNOT corrupt a result: a cache hit returns precisely the vector the
 *      model would have returned for that text, and a truncated shard is
 *      already discarded and rebuilt by EmbeddingCache. Deleting it buys no
 *      correctness and costs real quota — refilling it for NFCorpus alone is
 *      ~1,479 neurons, about 15% of a day's free allowance. KEPT unless you
 *      pass --cache.
 *
 * Tenant data is never touched. The harness writes only to namespaces prefixed
 * `__eval__:`; tenant namespaces are `t_{tenantId}__c_{collectionId}` and are
 * reported as protected rather than deleted. There is no flag to override that.
 *
 * Flags:
 *   --dataset <name>  Only namespaces for one dataset (`starter`,
 *                     `beir-nfcorpus`, …). Local directories are left alone,
 *                     since they are not per-dataset.
 *   --cache           ALSO delete the embedding cache. Costs quota to rebuild.
 *   --keep-results    Leave eval/results/ in place.
 *   --dry-run         Show exactly what would be deleted, delete nothing.
 *   --yes             Skip the confirmation prompt.
 */

async function main(): Promise<void> {
  loadEnvFiles();
  const args = parseArgs();

  const dataset = args.value("dataset");
  const dropCache = args.flag("cache");
  const dropResults = !args.flag("keep-results") && !dataset;
  const dryRun = args.flag("dry-run");

  requireCredentials({ ai: false, vectors: true });

  const store = new PineconeVectorStore();
  const { targets, protectedNamespaces, total, counts } = await selectEvalNamespaces(store, dataset);

  // --- Show the plan before doing anything ----------------------------------
  console.log("");
  console.log(`  Pinecone index — ${total} namespace(s) total`);
  console.log("");

  if (targets.length === 0) {
    console.log(
      `    (no evaluation namespaces${dataset ? ` for dataset "${dataset}"` : ""} to delete)`,
    );
  } else {
    const totalVectors = targets.reduce((sum, ns) => sum + (counts[ns] ?? 0), 0);
    console.log(`    DELETE ${targets.length} evaluation namespace(s), ${totalVectors.toLocaleString()} vectors:`);
    for (const namespace of targets) {
      console.log(`      ${namespace}  (${(counts[namespace] ?? 0).toLocaleString()} vectors)`);
    }
  }
  console.log("");

  if (protectedNamespaces.length > 0) {
    console.log(`    PROTECTED — not ours, will not be touched (${protectedNamespaces.length}):`);
    for (const namespace of protectedNamespaces.slice(0, 10)) {
      console.log(`      ${namespace}  (${(counts[namespace] ?? 0).toLocaleString()} vectors)`);
    }
    if (protectedNamespaces.length > 10) {
      console.log(`      … and ${protectedNamespaces.length - 10} more`);
    }
    console.log("");
  }

  const results = summarizeDirectory(LOCAL_STATE.results);
  const cache = summarizeDirectory(LOCAL_STATE.cache);

  console.log("  Local state");
  console.log("");
  console.log(
    `    ${dropResults ? "DELETE" : "KEEP  "}  results  ${results.entries} file(s), ` +
      `${formatBytes(results.bytes)}` +
      (dropResults ? "" : dataset ? "  (--dataset given: results are not per-dataset)" : "  (--keep-results)"),
  );
  console.log(
    `    ${dropCache ? "DELETE" : "KEEP  "}  cache    ${cache.entries} shard(s), ` +
      `${formatBytes(cache.bytes)}` +
      (dropCache ? "  (--cache: this costs quota to rebuild)" : "  (content-addressed; cannot corrupt a result)"),
  );
  console.log("");

  const nothingToDo =
    targets.length === 0 &&
    !(dropResults && results.exists && results.entries > 0) &&
    !(dropCache && cache.exists && cache.entries > 0);

  if (nothingToDo) {
    console.log("  Already clean — nothing to do.\n");
    return;
  }

  if (dryRun) {
    console.log("  --dry-run: nothing was deleted.\n");
    return;
  }

  // --- Confirm --------------------------------------------------------------
  if (!args.flag("yes")) {
    if (!process.stdin.isTTY) {
      throw new Error("stdin is not interactive — re-run with --yes to confirm the deletion.");
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question("  Proceed? [y/N] ");
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log("  Aborted. Nothing was deleted.\n");
        return;
      }
    } finally {
      rl.close();
    }
    console.log("");
  }

  // --- Delete ---------------------------------------------------------------
  await deleteEvalNamespaces(store, targets, (message) => console.log(`    ${message}`));

  if (dropResults && results.exists) {
    removeEvalDirectory(LOCAL_STATE.results);
    console.log(`    ✓ deleted ${results.entries} result file(s)`);
  }
  if (dropCache && cache.exists) {
    removeEvalDirectory(LOCAL_STATE.cache);
    console.log(`    ✓ deleted ${cache.entries} cache shard(s)`);
  }

  console.log("");
  console.log("  Clean.");
  if (!dropCache && cache.entries > 0) {
    console.log(
      `\n  The embedding cache was kept (${formatBytes(cache.bytes)}), so re-indexing costs no\n` +
        "  quota. It is keyed by hash(model + text) and cannot make a run wrong; pass --cache if\n" +
        "  you want it gone anyway.",
    );
  }
  if (targets.length > 0) {
    // Namespace names are a hash of the configuration, so the next run
    // re-creates these exact names — and a late-arriving delete can empty a
    // namespace *during* that run. Both runners detect it and refuse to report,
    // but not racing it is cheaper than discovering it.
    console.log(
      "\n  Note: Pinecone reports a namespace as deleted before the delete has fully propagated.\n" +
        "  Wait a few minutes before the next `pnpm eval:run` / `pnpm eval:beir`. If you do not,\n" +
        "  the run detects the index changing underneath it and aborts rather than reporting\n" +
        "  corrupted metrics.",
    );
  }
  console.log("");
}

main().catch(fail);

import { createInterface } from "node:readline/promises";
import { PineconeVectorStore } from "../../src/server/services/vectorstore";
import { EVAL_NAMESPACE_PREFIX } from "../config";
import { loadEnvFiles, requireCredentials } from "../lib/bootstrap";
import { fail, parseArgs } from "../lib/cli";
import { waitForNamespaceGone } from "../lib/indexer";
import { assertEvalNamespace, isEvalNamespace } from "../lib/namespace";
import { withRetries } from "../lib/retry";

/**
 * `pnpm eval:clean [-- --dataset <name>] [--yes]`
 *
 * Deletes the harness's Pinecone namespaces. Every candidate is checked against
 * {@link isEvalNamespace} first and again immediately before the delete — this
 * command runs against the same index that holds real tenant documents, whose
 * namespaces are `t_{tenantId}__c_{collectionId}`, and a prefix check is the
 * only thing separating a cleanup from data loss.
 *
 * Flags:
 *   --dataset <name>  Only namespaces for this dataset.
 *   --yes             Skip the confirmation prompt.
 *   --dry-run         List what would be deleted and stop.
 */

async function main(): Promise<void> {
  loadEnvFiles();
  const args = parseArgs();
  requireCredentials({ ai: false, vectors: true });

  const store = new PineconeVectorStore();
  const all = Object.keys(await withRetries("read index stats", () => store.namespaceStats()));

  const dataset = args.value("dataset");
  const targets = all
    .filter(isEvalNamespace)
    .filter((ns) => !dataset || ns.startsWith(`${EVAL_NAMESPACE_PREFIX}:${dataset}:`));

  const protectedCount = all.length - all.filter(isEvalNamespace).length;
  console.log(
    `\n  ${all.length} namespace(s) in the index — ${targets.length} match the evaluation prefix, ` +
      `${protectedCount} are not ours and will not be touched.\n`,
  );

  if (targets.length === 0) {
    console.log("  Nothing to clean.\n");
    return;
  }
  for (const namespace of targets) console.log(`    ${namespace}`);
  console.log("");

  if (args.flag("dry-run")) {
    console.log("  --dry-run: nothing deleted.\n");
    return;
  }

  if (!args.flag("yes")) {
    if (!process.stdin.isTTY) {
      throw new Error("stdin is not interactive — re-run with --yes to confirm the deletion.");
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(`  Delete ${targets.length} namespace(s)? [y/N] `);
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log("  Aborted.\n");
        return;
      }
    } finally {
      rl.close();
    }
  }

  for (const namespace of targets) {
    // Re-checked at the point of deletion, not only at selection time.
    assertEvalNamespace(namespace);
    await withRetries(`delete ${namespace}`, () => store.deleteNamespace(namespace));
    console.log(`    ✓ deleted ${namespace}`);
  }

  console.log("\n  Waiting for deletions to propagate…");
  for (const namespace of targets) {
    await waitForNamespaceGone(store, namespace, (message) => console.log(`    ${message}`));
  }

  console.log(`\n  Removed ${targets.length} evaluation namespace(s).`);
  // Index stats report a namespace as gone well before the delete has finished
  // propagating, so the wait above is necessary but NOT sufficient. Namespace
  // names are a hash of the configuration, so the next `eval:run` re-creates
  // these exact names and a late-arriving delete can empty them mid-run.
  // `runExperiment` detects that and refuses to report the numbers, but the
  // cheaper fix is simply not to race it.
  console.log(
    "\n  Note: Pinecone reports a namespace as deleted before the delete has fully propagated.\n" +
      "  Wait a few minutes before the next `pnpm eval:run`. If you do not, the run will detect\n" +
      "  the index changing underneath it and abort rather than report corrupted metrics.\n",
  );
  console.log("  The on-disk embedding cache is untouched — delete eval/.cache to clear it.\n");
}

main().catch(fail);

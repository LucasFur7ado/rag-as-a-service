import { createInterface } from "node:readline/promises";
import { PineconeVectorStore } from "../../src/server/services/vectorstore";
import { loadEnvFiles, requireCredentials } from "../lib/bootstrap";
import { fail, parseArgs } from "../lib/cli";
import { deleteEvalNamespaces, selectEvalNamespaces } from "../lib/cleanup";

/**
 * `pnpm eval:clean [-- --dataset <name>] [--yes]`
 *
 * Deletes the harness's Pinecone namespaces, and only those. Every candidate is
 * checked when selected and again immediately before the delete — this command
 * runs against the same index that holds real tenant documents, whose
 * namespaces are `t_{tenantId}__c_{collectionId}`, and a prefix check is the
 * only thing separating a cleanup from data loss. Both checks live in
 * lib/cleanup.ts so this script and `eval:reset` cannot disagree about them.
 *
 * For a full clean slate — namespaces plus run output, and optionally the
 * embedding cache — use `pnpm eval:reset`, which prints what each kind of state
 * can and cannot do to a result before deleting it.
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
  const dataset = args.value("dataset");
  const { targets, protectedNamespaces, total, counts } = await selectEvalNamespaces(store, dataset);

  console.log(
    `\n  ${total} namespace(s) in the index — ` +
      `${targets.length} match the evaluation prefix, ` +
      `${protectedNamespaces.length} are not ours and will not be touched.\n`,
  );

  if (targets.length === 0) {
    console.log("  Nothing to clean.\n");
    return;
  }
  for (const namespace of targets) {
    console.log(`    ${namespace}  (${(counts[namespace] ?? 0).toLocaleString()} vectors)`);
  }
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

  await deleteEvalNamespaces(store, targets, (message) => console.log(`    ${message}`));

  console.log(`\n  Removed ${targets.length} evaluation namespace(s).`);
  // Index stats report a namespace as gone well before the delete has finished
  // propagating, so the wait inside deleteEvalNamespaces is necessary but NOT
  // sufficient. Namespace names are a hash of the configuration, so the next
  // run re-creates these exact names and a late-arriving delete can empty them
  // mid-run. Both runners detect that and refuse to report the numbers, but the
  // cheaper fix is simply not to race it.
  console.log(
    "\n  Note: Pinecone reports a namespace as deleted before the delete has fully propagated.\n" +
      "  Wait a few minutes before the next `pnpm eval:run`. If you do not, the run will detect\n" +
      "  the index changing underneath it and abort rather than report corrupted metrics.\n",
  );
  console.log("  The on-disk embedding cache is untouched — `pnpm eval:reset -- --cache` clears it.\n");
}

main().catch(fail);

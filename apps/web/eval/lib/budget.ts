import { createInterface } from "node:readline/promises";
import {
  DEFAULT_NEURON_RATE,
  FREE_NEURONS_PER_DAY,
  NEURONS_PER_MILLION_TOKENS,
  NEURON_BUDGET_PROMPT_THRESHOLD,
} from "../config";
import { countTokens } from "../../src/server/lib/tokens";
import { estimateCost } from "../../src/server/config";

/**
 * Quota estimation and the confirmation gate.
 *
 * Workers AI gives 10,000 Neurons a day, and generation eats them far faster
 * than embedding does. The failure this guards against is mundane and
 * expensive: pointing the harness at a corpus an order of magnitude larger than
 * intended and discovering it after the day's allowance is gone. So a run
 * prices itself first, prints the estimate, and stops for confirmation when it
 * is material.
 *
 * Token counts come from `countTokens` — the same js-tiktoken BPE the context
 * budget uses. That is cl100k_base, not bge-m3's or Llama's own tokenizer, so
 * treat the result as an estimate good to a few percent on English prose and
 * looser on other scripts. It is a spend guard, not an invoice.
 */

export interface NeuronEstimate {
  inputTokens: number;
  outputTokens: number;
  neurons: number;
  /** List-price USD equivalent, via the app's own MODEL_COSTS table. */
  usd: number;
  model: string;
}

function rateFor(model: string) {
  return NEURONS_PER_MILLION_TOKENS[model] ?? DEFAULT_NEURON_RATE;
}

/** Price a planned workload for one model. */
export function estimateNeurons(
  model: string,
  inputTokens: number,
  outputTokens = 0,
): NeuronEstimate {
  const rate = rateFor(model);
  const neurons =
    (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  return {
    model,
    inputTokens,
    outputTokens,
    neurons,
    usd: estimateCost(model, inputTokens, outputTokens),
  };
}

/** Total input tokens across a set of texts. */
export function tokensIn(texts: string[]): number {
  return texts.reduce((sum, text) => sum + countTokens(text), 0);
}

/** Combine several estimates into one line for the summary. */
export function totalNeurons(estimates: NeuronEstimate[]): number {
  return estimates.reduce((sum, e) => sum + e.neurons, 0);
}

/** Render an estimate as the block a run prints before it spends anything. */
export function formatEstimate(estimates: NeuronEstimate[]): string {
  const lines = estimates
    .filter((e) => e.inputTokens > 0 || e.outputTokens > 0)
    .map(
      (e) =>
        `    ${e.model}\n` +
        `      ${e.inputTokens.toLocaleString()} input + ${e.outputTokens.toLocaleString()} output tokens` +
        ` → ${Math.ceil(e.neurons).toLocaleString()} neurons (~$${e.usd.toFixed(4)})`,
    );
  const total = totalNeurons(estimates);
  const share = ((total / FREE_NEURONS_PER_DAY) * 100).toFixed(1);
  return (
    `  Estimated Workers AI spend:\n${lines.join("\n")}\n` +
    `    TOTAL ~${Math.ceil(total).toLocaleString()} neurons — ${share}% of the ${FREE_NEURONS_PER_DAY.toLocaleString()}/day free allowance`
  );
}

/**
 * Stop and ask before spending a material amount of the daily allowance.
 *
 * `--yes` skips the prompt. A non-interactive shell cannot be asked, so it is
 * refused rather than silently approved: an unattended run is exactly the case
 * where an unnoticed cost estimate does damage.
 */
export async function confirmBudget(
  estimates: NeuronEstimate[],
  options: { yes: boolean; threshold?: number },
): Promise<void> {
  const total = totalNeurons(estimates);
  const threshold = options.threshold ?? NEURON_BUDGET_PROMPT_THRESHOLD;

  console.log(formatEstimate(estimates));
  if (total <= threshold || options.yes) return;

  if (!process.stdin.isTTY) {
    throw new Error(
      `This run is estimated at ~${Math.ceil(total).toLocaleString()} neurons, above the ` +
        `${threshold.toLocaleString()} confirmation threshold, and stdin is not interactive. ` +
        `Re-run with --yes to approve it.`,
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `\n  This exceeds the ${threshold.toLocaleString()}-neuron threshold. Proceed? [y/N] `,
    );
    if (!/^y(es)?$/i.test(answer.trim())) throw new Error("Aborted at the budget prompt.");
  } finally {
    rl.close();
  }
}

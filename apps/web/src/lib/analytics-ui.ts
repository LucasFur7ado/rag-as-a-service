import type { UsageEventStatus } from "@rag/shared";

/**
 * Single source of truth for analytics visual semantics (Feature 5).
 *
 * Colors are THEME TOKENS (`var(--color-chart-*)`, defined once in
 * globals.css for light + dark) — never hardcoded hex — so every chart, badge,
 * and legend uses the same success/error/rate-limited/no-results color, and
 * dark mode is handled by the CSS variables automatically.
 */

/** Query outcome → theme-token color. Reused across every widget. */
export const STATUS_COLOR: Record<UsageEventStatus, string> = {
  success: "var(--color-chart-success)",
  error: "var(--color-chart-error)",
  rate_limited: "var(--color-chart-rate-limited)",
  no_results: "var(--color-chart-no-results)",
};

/** Human labels for outcomes (used in legends, tooltips, badges). */
export const STATUS_LABEL: Record<UsageEventStatus, string> = {
  success: "Success",
  error: "Error",
  rate_limited: "Rate limited",
  no_results: "No results",
};

/** Tailwind classes for a status badge (bg tint + text), theme-aware. */
export const STATUS_BADGE_CLASS: Record<UsageEventStatus, string> = {
  success: "bg-chart-success/15 text-chart-success",
  error: "bg-chart-error/15 text-chart-error",
  rate_limited: "bg-chart-rate-limited/15 text-chart-rate-limited",
  no_results: "bg-chart-no-results/15 text-chart-no-results",
};

/** Pipeline-stage colors (embedding / retrieval / generation). */
export const STAGE_COLOR = {
  embed: "var(--color-chart-embed)",
  retrieval: "var(--color-chart-retrieval)",
  generation: "var(--color-chart-generation)",
} as const;

export const TOKENS_COLOR = "var(--color-chart-tokens)";
export const COST_COLOR = "var(--color-chart-cost)";

/** Stable order for stacking status series (bottom → top). */
export const STATUS_ORDER: UsageEventStatus[] = [
  "success",
  "no_results",
  "rate_limited",
  "error",
];

/**
 * Date-range presets + URL <-> range resolution for the analytics dashboard
 * (Feature 5). Pure functions (no React) so they're trivially testable and
 * usable on both the reading and writing side of the URL query string.
 *
 * Persistence model (static export, client-only): the selection lives entirely
 * in the URL query string, so it is shareable and survives refresh. Presets
 * recompute `now` at resolve time (so "Last 24h" is always the last 24h);
 * `custom` pins absolute `from`/`to`.
 */

export type RangePreset = "24h" | "7d" | "30d" | "custom";

export interface ResolvedRange {
  preset: RangePreset;
  /** Inclusive start, epoch ms. */
  from: number;
  /** Exclusive end, epoch ms. */
  to: number;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom range" },
];

const PRESET_SPAN: Record<Exclude<RangePreset, "custom">, number> = {
  "24h": 24 * HOUR,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
};

/**
 * Resolve the effective range from URL params. Falls back to the 7d preset for
 * a missing/invalid `range`, or an invalid custom window. `now` is read once
 * here — callers should memoize on the raw param string so it stays stable
 * between renders.
 */
export function resolveRange(
  rangeParam: string | null,
  fromParam: string | null,
  toParam: string | null,
  now: number = Date.now(),
): ResolvedRange {
  const preset: RangePreset =
    rangeParam === "24h" ||
    rangeParam === "7d" ||
    rangeParam === "30d" ||
    rangeParam === "custom"
      ? rangeParam
      : "7d";

  if (preset === "custom") {
    const from = Number(fromParam);
    const to = Number(toParam);
    if (Number.isFinite(from) && Number.isFinite(to) && from < to) {
      return { preset: "custom", from, to };
    }
    // Invalid custom window → safe default.
    return { preset: "7d", from: now - PRESET_SPAN["7d"], to: now };
  }

  return { preset, from: now - PRESET_SPAN[preset], to: now };
}

/** `<input type="datetime-local">` value (local time) from epoch ms. */
export function toDatetimeLocal(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

/** Epoch ms from a `datetime-local` value; NaN when empty/invalid. */
export function fromDatetimeLocal(value: string): number {
  return new Date(value).getTime();
}

/** Short label for the currently-resolved range (header display). */
export function rangeLabel(range: ResolvedRange): string {
  const preset = RANGE_PRESETS.find((p) => p.value === range.preset);
  if (range.preset !== "custom") return preset?.label ?? "";
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return `${fmt(range.from)} – ${fmt(range.to)}`;
}

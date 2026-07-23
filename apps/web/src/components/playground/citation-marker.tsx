"use client";

import { useState } from "react";
import type { Citation } from "@rag/shared";

/**
 * An inline `[n]` citation marker inside the answer. Hover/focus reveals a
 * card with the source's filename, page, score and snippet; clicking asks the
 * parent to focus the matching entry in the Sources panel.
 *
 * Self-contained (no popover dependency): the card is an absolutely-positioned
 * element toggled by hover + focus so it also works for keyboard users.
 */
export function CitationMarker({
  marker,
  source,
  onActivate,
}: {
  marker: number;
  /** The resolved source, or undefined if the model cited a bad marker. */
  source: Citation | undefined;
  onActivate: (marker: number) => void;
}) {
  const [open, setOpen] = useState(false);

  // Defensive: linkification only runs for valid markers, but guard anyway so
  // a hallucinated marker never renders as an interactive citation.
  if (!source) return <span>[{marker}]</span>;

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/10 px-1 align-super text-[0.65rem] font-semibold text-primary tabular-nums transition-colors hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        aria-label={`Source ${marker}: ${source.filename}${source.page != null ? `, page ${source.page}` : ""}`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => onActivate(marker)}
      >
        {marker}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-20 mb-1 w-72 -translate-x-1/2 rounded-lg border border-border bg-popover p-3 text-left text-popover-foreground shadow-md"
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-medium">{source.filename}</span>
            <span className="shrink-0 text-[0.65rem] text-muted-foreground">
              {source.page != null ? `p. ${source.page} · ` : ""}
              {(source.score * 100).toFixed(0)}%
            </span>
          </span>
          <span className="mt-1.5 block max-h-32 overflow-hidden text-xs leading-snug text-muted-foreground">
            {source.snippet}
          </span>
        </span>
      )}
    </span>
  );
}

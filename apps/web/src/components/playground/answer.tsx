"use client";

import { useMemo } from "react";
import Markdown from "react-markdown";
import type { Citation } from "@rag/shared";
import { CitationMarker } from "./citation-marker";

/**
 * Renders the generated answer as Markdown with inline, interactive `[n]`
 * citation markers.
 *
 * Approach: rewrite each VALID `[n]` marker in the raw answer into a Markdown
 * link `[[n]](cite:n)` before parsing, then override the `a` renderer so
 * `cite:` links become <CitationMarker>. Markers that don't map to a real
 * retrieved source (hallucinated) are left as plain text — never linked.
 */
export function Answer({
  text,
  sources,
  onCitationActivate,
}: {
  text: string;
  sources: Citation[];
  onCitationActivate: (marker: number) => void;
}) {
  const byMarker = useMemo(
    () => new Map(sources.map((s) => [s.marker, s])),
    [sources],
  );

  const linkified = useMemo(
    () => linkifyCitations(text, byMarker),
    [text, byMarker],
  );

  return (
    <div className="text-sm leading-relaxed [&_a:not([data-cite])]:text-primary [&_a:not([data-cite])]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown
        components={{
          a({ href, children }) {
            const marker = parseCiteHref(href);
            if (marker !== null) {
              return (
                <CitationMarker
                  marker={marker}
                  source={byMarker.get(marker)}
                  onActivate={onCitationActivate}
                />
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {linkified}
      </Markdown>
    </div>
  );
}

/** `cite:3` → 3; anything else → null. */
function parseCiteHref(href: string | undefined): number | null {
  if (!href?.startsWith("cite:")) return null;
  const n = Number(href.slice(5));
  return Number.isInteger(n) ? n : null;
}

/**
 * Rewrite `[n]` / `[1, 2]` markers into Markdown `cite:` links, but only for
 * markers present in `valid`. Escapes so an already-Markdown answer keeps its
 * own links intact (we only touch bare bracketed numbers).
 */
function linkifyCitations(
  text: string,
  valid: Map<number, Citation>,
): string {
  return text.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (whole, inner: string) => {
    const nums = inner.split(",").map((s) => Number(s.trim()));
    // If none of the grouped markers are real, leave the text untouched.
    if (!nums.some((n) => valid.has(n))) return whole;
    return nums
      .map((n) => (valid.has(n) ? `[[${n}]](cite:${n})` : `[${n}]`))
      .join("");
  });
}

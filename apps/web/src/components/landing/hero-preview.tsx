import { FileTextIcon } from "lucide-react";

/**
 * Static product preview shown under the hero: the shape of a real
 * `POST /v1/collections/:id/query` response — a grounded answer whose inline
 * `[n]` markers resolve to the chunks that were actually retrieved.
 *
 * Purely decorative/illustrative markup (no data fetching), so it renders in
 * the static export and ships zero JavaScript.
 */

const SOURCES = [
  { marker: 1, filename: "handbook.pdf", page: 12, score: 0.82 },
  { marker: 2, filename: "billing-policy.md", page: null, score: 0.74 },
];

const USAGE = [
  { label: "Retrieved", value: "8 chunks" },
  { label: "Used", value: "5 chunks" },
  { label: "Context", value: "1,240 tokens" },
  { label: "Model", value: "llama-3.3-70b" },
];

/** Small superscript chip standing in for an inline citation marker. */
function Marker({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 inline-flex size-4 items-center justify-center rounded-[4px] bg-foreground/10 font-mono text-[10px] leading-none font-medium text-foreground">
      {n}
    </sup>
  );
}

export function HeroPreview() {
  return (
    <div
      aria-hidden
      className="w-full max-w-3xl overflow-hidden rounded-xl bg-card text-left shadow-lg ring-1 ring-foreground/10"
    >
      {/* Window chrome / request line */}
      <div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
        </span>
        <code className="truncate font-mono text-xs text-muted-foreground">
          POST /v1/collections/col_9f8b2a1c/query
        </code>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {/* The question */}
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          What is the refund policy for annual plans?
        </p>

        {/* The grounded answer */}
        <p className="text-sm leading-relaxed">
          Annual plans can be refunded in full within 30 days of purchase
          <Marker n={1} />. After that window the plan converts to a pro-rated
          credit that stays on the account for twelve months
          <Marker n={2} />.
          <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-foreground/60 motion-reduce:animate-none" />
        </p>

        {/* Resolved citations */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Sources
          </span>
          <ul className="flex flex-wrap gap-2">
            {SOURCES.map((source) => (
              <li
                key={source.marker}
                className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
              >
                <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-medium">{source.filename}</span>
                {source.page ? (
                  <span className="text-muted-foreground">p. {source.page}</span>
                ) : null}
                <span className="font-mono text-muted-foreground">
                  {source.score.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Usage footer */}
      <dl className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-4">
        {USAGE.map((item) => (
          <div key={item.label} className="bg-card px-4 py-2.5">
            <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
            <dd className="truncate font-mono text-xs">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

import { cn } from "@/lib/utils";

/**
 * Color-coded HTTP method badge. Colors come from the shared chart theme tokens
 * (light + dark values live in globals.css), never hardcoded hex.
 */
const METHOD_STYLES: Record<string, string> = {
  GET: "bg-chart-embed/10 text-chart-embed",
  POST: "bg-chart-success/10 text-chart-success",
  PUT: "bg-chart-retrieval/10 text-chart-retrieval",
  PATCH: "bg-chart-rate-limited/10 text-chart-rate-limited",
  DELETE: "bg-chart-error/10 text-chart-error",
};

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  const upper = method.toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wide",
        METHOD_STYLES[upper] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {upper}
    </span>
  );
}

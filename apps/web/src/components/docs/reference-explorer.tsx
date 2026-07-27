"use client";

import { useEffect, useMemo, useState } from "react";
import { groupByTag, listOperations } from "@/lib/openapi";
import type { EndpointSamples } from "./code-samples-tabs";
import { MethodBadge } from "./method-badge";
import { EndpointDetail } from "./endpoint-detail";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * The API reference: a filterable, tag-grouped endpoint list (sticky sidebar)
 * beside the selected endpoint's detail. Everything renders from the embedded
 * spec — no endpoint is hand-written. Deep links work via the URL hash.
 */
export function ReferenceExplorer({
  samples,
  baseUrl,
}: {
  samples: Record<string, EndpointSamples>;
  baseUrl: string;
}) {
  const groups = useMemo(() => groupByTag(), []);
  const allOps = useMemo(() => listOperations(), []);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string>(() => allOps[0]?.anchor ?? "");

  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash && allOps.some((o) => o.anchor === hash)) setSelected(hash);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [allOps]);

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        operations: g.operations.filter((o) =>
          `${o.method} ${o.path} ${o.summary ?? ""}`.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.operations.length > 0);
  }, [groups, filter]);

  const current = allOps.find((o) => o.anchor === selected) ?? allOps[0];

  function select(anchor: string) {
    setSelected(anchor);
    if (typeof history !== "undefined") history.replaceState(null, "", `#${anchor}`);
  }

  return (
    <div className="flex gap-8">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-20">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter endpoints…"
            className="mb-3"
          />
          <ScrollArea className="h-[calc(100vh-9rem)] pr-3">
            <div className="flex flex-col gap-4">
              {filteredGroups.map((group) => (
                <div key={group.name}>
                  <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.name}
                  </p>
                  <div className="flex flex-col">
                    {group.operations.map((op) => (
                      <button
                        key={op.anchor}
                        type="button"
                        onClick={() => select(op.anchor)}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                          op.anchor === selected
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50",
                        )}
                      >
                        <MethodBadge method={op.method} className="w-14 justify-center" />
                        <span className="truncate text-xs text-muted-foreground">{op.summary ?? op.path}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {filteredGroups.length === 0 ? (
                <p className="px-1 text-sm text-muted-foreground">No endpoints match “{filter}”.</p>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      </aside>

      {/* Mobile endpoint picker */}
      <div className="min-w-0 flex-1">
        <select
          value={selected}
          onChange={(e) => select(e.target.value)}
          className="mb-6 w-full rounded-md border bg-background px-3 py-2 text-sm lg:hidden"
          aria-label="Select an endpoint"
        >
          {groups.map((group) => (
            <optgroup key={group.name} label={group.name}>
              {group.operations.map((op) => (
                <option key={op.anchor} value={op.anchor}>
                  {op.method} {op.path}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {current && samples[current.anchor] ? (
          <EndpointDetail op={current} samples={samples[current.anchor]} baseUrl={baseUrl} />
        ) : (
          <p className="text-sm text-muted-foreground">Select an endpoint to see its reference.</p>
        )}
      </div>
    </div>
  );
}

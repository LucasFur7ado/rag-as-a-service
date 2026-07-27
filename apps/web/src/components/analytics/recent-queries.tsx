"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  ListIcon,
} from "lucide-react";
import type { RecentEventsResponse, UsageEvent, UsageEventStatus } from "@rag/shared";
import type { ApiClient } from "@/lib/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_BADGE_CLASS, STATUS_LABEL } from "@/lib/analytics-ui";
import { formatCount, formatLatency, formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EventDetailSheet } from "./event-detail-sheet";

/**
 * Recent queries drill-down table (Feature 5, Part C §7). Sortable columns
 * (client-side over loaded rows), server-side cursor pagination, a status
 * filter, and a full-detail sheet on row activation. Rows are keyboard
 * focusable and open on Enter/Space.
 *
 * Which columns render is caller-controlled via `columns` (default: all of
 * them). Narrow placements — the dashboard overview sits at half width — pass
 * a subset; nothing is lost, since every field is in the detail sheet a click
 * away on any row.
 */

type SortKey =
  | "createdAt"
  | "latencyTotalMs"
  | "chunksRetrieved"
  | "topScore"
  | "tokens";
type SortDir = "asc" | "desc";

/** Every available column, in display order. */
export const ALL_COLUMNS = [
  "time",
  "collection",
  "status",
  "latency",
  "chunks",
  "topScore",
  "tokens",
  "auth",
] as const;

export type RecentQueriesColumn = (typeof ALL_COLUMNS)[number];

/** The four worth scanning when the table is squeezed into half a row. */
export const COMPACT_COLUMNS: readonly RecentQueriesColumn[] = [
  "time",
  "status",
  "latency",
  "tokens",
];

interface ColumnDef {
  label: string;
  /** Right-aligns and tabular-numbers both the header and the cell. */
  numeric?: boolean;
  /** Present when the column is sortable. */
  sortKey?: SortKey;
  cellClassName?: string;
  cell: (e: UsageEvent) => ReactNode;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
  { value: "rate_limited", label: "Rate limited" },
  { value: "no_results", label: "No results" },
];

function tokensOf(e: UsageEvent): number {
  return (e.tokensPrompt ?? 0) + (e.tokensCompletion ?? 0);
}

export function RecentQueries({
  api,
  from,
  to,
  collectionId,
  collectionName,
  columns = ALL_COLUMNS,
}: {
  api: ApiClient;
  from: number;
  to: number;
  collectionId?: string;
  collectionName: (id: string | null) => string;
  /** Columns to render, in `ALL_COLUMNS` order. Defaults to all of them. */
  columns?: readonly RecentQueriesColumn[];
}) {
  const [status, setStatus] = useState<string>("all");
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UsageEvent | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "createdAt",
    dir: "desc",
  });

  const baseParams = useMemo(
    () => ({
      from,
      to,
      collectionId,
      status: status === "all" ? undefined : (status as UsageEventStatus),
      limit: 25,
    }),
    [from, to, collectionId, status],
  );

  // Reset + fetch first page whenever the range / collection / status changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getAnalyticsRecent(baseParams)
      .then((res: RecentEventsResponse) => {
        if (cancelled) return;
        setEvents(res.events);
        setNextCursor(res.nextCursor);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setEvents([]);
        setNextCursor(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, baseParams]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await api.getAnalyticsRecent({ ...baseParams, cursor: nextCursor });
      setEvents((prev) => [...prev, ...res.events]);
      setNextCursor(res.nextCursor);
    } catch {
      // Keep what we have; a transient failure just means "Load more" stays.
    } finally {
      setLoadingMore(false);
    }
  }, [api, baseParams, nextCursor]);

  const sorted = useMemo(() => {
    const value = (e: UsageEvent): number => {
      switch (sort.key) {
        case "createdAt":
          return e.createdAt;
        case "latencyTotalMs":
          return e.latencyTotalMs ?? -1;
        case "chunksRetrieved":
          return e.chunksRetrieved ?? -1;
        case "topScore":
          return e.topScore ?? -1;
        case "tokens":
          return tokensOf(e);
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...events].sort((a, b) => (value(a) - value(b)) * dir);
  }, [events, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );

  // Each header and its cell are defined together, so trimming `columns` can
  // never leave the two out of step.
  const columnDefs = useMemo<Record<RecentQueriesColumn, ColumnDef>>(
    () => ({
      time: {
        label: "Time",
        sortKey: "createdAt",
        cellClassName: "whitespace-nowrap text-xs text-muted-foreground",
        cell: (e) => formatTimestamp(e.createdAt),
      },
      collection: {
        label: "Collection",
        cellClassName: "max-w-[10rem] truncate text-xs",
        cell: (e) =>
          e.eventType === "ingestion"
            ? "— (ingestion)"
            : collectionName(e.collectionId),
      },
      status: {
        label: "Status",
        cell: (e) => <StatusBadge status={e.status} />,
      },
      latency: {
        label: "Latency",
        numeric: true,
        sortKey: "latencyTotalMs",
        cell: (e) => formatLatency(e.latencyTotalMs),
      },
      chunks: {
        label: "Chunks",
        numeric: true,
        sortKey: "chunksRetrieved",
        cell: (e) => e.chunksRetrieved ?? "—",
      },
      topScore: {
        label: "Top score",
        numeric: true,
        sortKey: "topScore",
        cell: (e) =>
          e.topScore != null ? `${(e.topScore * 100).toFixed(0)}%` : "—",
      },
      tokens: {
        label: "Tokens",
        numeric: true,
        sortKey: "tokens",
        cell: (e) => (tokensOf(e) > 0 ? formatCount(tokensOf(e)) : "—"),
      },
      auth: {
        label: "Auth",
        cellClassName: "text-xs",
        cell: (e) => (e.authType === "apikey" ? "API key" : "Dashboard"),
      },
    }),
    [collectionName],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListIcon className="size-4 text-muted-foreground" />
          Recent queries
        </CardTitle>
        <CardDescription>Newest first · click a row for full detail</CardDescription>
        <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
          <Select value={status} onValueChange={(v) => setStatus(v ?? "all")}>
            <SelectTrigger size="sm" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : events.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium">No queries in this range</p>
            <p className="text-xs text-muted-foreground">
              Adjust the filters or run a query from the playground.
            </p>
          </div>
        ) : (
          <>
            {/* Horizontal scroll on small screens keeps the table readable. */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((id) => {
                      const col = columnDefs[id];
                      const { sortKey } = col;
                      return sortKey ? (
                        <SortHeader
                          key={id}
                          label={col.label}
                          active={sort.key === sortKey}
                          dir={sort.dir}
                          onClick={() => toggleSort(sortKey)}
                          numeric={col.numeric}
                        />
                      ) : (
                        <TableHead
                          key={id}
                          className={col.numeric ? "text-right" : undefined}
                        >
                          {col.label}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((e) => (
                    <TableRow
                      key={e.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`View details for event from ${formatTimestamp(e.createdAt)}`}
                      onClick={() => setSelected(e)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          setSelected(e);
                        }
                      }}
                      className="cursor-pointer outline-none focus-visible:bg-accent/60"
                    >
                      {columns.map((id) => {
                        const col = columnDefs[id];
                        return (
                          <TableCell
                            key={id}
                            className={cn(
                              col.numeric && "text-right text-xs tabular-nums",
                              col.cellClassName,
                            )}
                          >
                            {col.cell(e)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {nextCursor && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      <EventDetailSheet
        event={selected}
        collectionName={collectionName}
        onClose={() => setSelected(null)}
      />
    </Card>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  numeric,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  numeric?: boolean;
}) {
  const Icon = !active ? ChevronsUpDownIcon : dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <TableHead className={numeric ? "text-right" : undefined}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm text-xs font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          numeric && "flex-row-reverse",
          active ? "text-foreground" : "text-muted-foreground",
        )}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className="size-3" />
      </button>
    </TableHead>
  );
}

export function StatusBadge({ status }: { status: UsageEventStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[0.7rem] font-medium",
        STATUS_BADGE_CLASS[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

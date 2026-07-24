"use client";

import { useMemo } from "react";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import type {
  AnalyticsSummary,
  MetricWithDelta,
  TimeseriesResponse,
} from "@rag/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalyticsResourceState } from "@/lib/use-analytics";
import {
  computeDelta,
  formatCost,
  formatCount,
  formatDelta,
  formatLatency,
  formatPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * KPI cards row (Feature 5, Part C §2): total queries, success rate, p95
 * latency, estimated cost — each with the value, a delta vs the previous
 * equal-length period (green/red + arrow), and a tiny sparkline sourced from
 * the same time-series the main chart uses.
 */

interface KpiCardsProps {
  summary: AnalyticsResourceState<AnalyticsSummary>;
  timeseries: AnalyticsResourceState<TimeseriesResponse>;
}

/** Whether an increase in this metric is "good" (green) or "bad" (red). */
type Sentiment = "up-good" | "up-bad" | "neutral";

interface KpiDef {
  key: string;
  label: string;
  pick: (s: AnalyticsSummary) => MetricWithDelta;
  format: (v: number) => string;
  sentiment: Sentiment;
  spark: (t: TimeseriesResponse) => number[];
}

const KPIS: KpiDef[] = [
  {
    key: "queries",
    label: "Total queries",
    pick: (s) => s.totalQueries,
    format: formatCount,
    sentiment: "up-good",
    spark: (t) =>
      t.points.map((p) => p.success + p.error + p.rateLimited + p.noResults),
  },
  {
    key: "success",
    label: "Success rate",
    pick: (s) => s.successRate,
    format: formatPercent,
    sentiment: "up-good",
    spark: (t) =>
      t.points.map((p) => {
        const total = p.success + p.error + p.rateLimited + p.noResults;
        return total > 0 ? p.success / total : 0;
      }),
  },
  {
    key: "p95",
    label: "p95 latency",
    pick: (s) => s.p95LatencyMs,
    format: (v) => formatLatency(v),
    sentiment: "up-bad",
    spark: (t) => t.points.map((p) => p.p95LatencyMs ?? 0),
  },
  {
    key: "cost",
    label: "Est. cost",
    pick: (s) => s.estimatedCost,
    format: formatCost,
    sentiment: "up-bad",
    spark: (t) => t.points.map((p) => p.estimatedCost),
  },
];

export function KpiCards({ summary, timeseries }: KpiCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {KPIS.map((kpi) => (
        <KpiCard
          key={kpi.key}
          def={kpi}
          summary={summary}
          timeseries={timeseries}
        />
      ))}
    </div>
  );
}

function KpiCard({
  def,
  summary,
  timeseries,
}: {
  def: KpiDef;
  summary: AnalyticsResourceState<AnalyticsSummary>;
  timeseries: AnalyticsResourceState<TimeseriesResponse>;
}) {
  if (summary.loading || (!summary.data && !summary.error)) {
    return (
      <Card>
        <CardContent className="space-y-3 py-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (summary.error || !summary.data) {
    return (
      <Card>
        <CardContent className="py-1">
          <p className="text-xs text-muted-foreground">{def.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">—</p>
          <p className="mt-2 text-xs text-destructive">Unavailable</p>
        </CardContent>
      </Card>
    );
  }

  const metric = def.pick(summary.data);
  const delta = computeDelta(metric.value, metric.previous);

  // Color the delta by sentiment: for "up-bad" metrics (latency, cost), an
  // increase is red; for "up-good" metrics, an increase is green.
  const good =
    delta.direction === "flat"
      ? "flat"
      : def.sentiment === "up-good"
        ? delta.direction === "up"
          ? "good"
          : "bad"
        : def.sentiment === "up-bad"
          ? delta.direction === "up"
            ? "bad"
            : "good"
          : "flat";

  const deltaColor =
    good === "good"
      ? "text-chart-success"
      : good === "bad"
        ? "text-chart-error"
        : "text-muted-foreground";

  const DeltaIcon =
    delta.direction === "up"
      ? ArrowUpRightIcon
      : delta.direction === "down"
        ? ArrowDownRightIcon
        : MinusIcon;

  const sparkValues = timeseries.data ? def.spark(timeseries.data) : [];

  return (
    <Card>
      <CardContent className="py-1">
        <p className="text-xs font-medium text-muted-foreground">{def.label}</p>
        <div className="mt-1 flex items-end justify-between gap-2">
          <p className="text-2xl font-semibold tabular-nums">
            {def.format(metric.value)}
          </p>
          <Sparkline
            values={sparkValues}
            className={cn(
              good === "bad" ? "text-chart-error" : "text-chart-success",
            )}
          />
        </div>
        <div className={cn("mt-2 flex items-center gap-1 text-xs", deltaColor)}>
          <DeltaIcon className="size-3.5" />
          <span className="font-medium tabular-nums">
            {formatDelta(delta.ratio)}
          </span>
          <span className="text-muted-foreground">vs. previous period</span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Minimal dependency-free SVG sparkline (no axes/labels). Uses `currentColor`
 * so the caller sets the hue via a text-* class (theme token). Renders nothing
 * when there's not enough data to draw a line.
 */
function Sparkline({
  values,
  className,
  width = 72,
  height = 28,
}: {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
}) {
  const path = useMemo(() => {
    if (values.length < 2) return null;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const stepX = width / (values.length - 1);
    return values
      .map((v, i) => {
        const x = i * stepX;
        // Pad 2px top/bottom so the stroke isn't clipped.
        const y = height - 2 - ((v - min) / span) * (height - 4);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values, width, height]);

  if (!path) return <div style={{ width, height }} aria-hidden />;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className={cn("shrink-0 opacity-80", className)}
      aria-hidden
    >
      <path
        d={path}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

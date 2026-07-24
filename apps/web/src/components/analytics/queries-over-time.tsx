"use client";

import { useMemo } from "react";
import { ActivityIcon } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeseriesResponse } from "@rag/shared";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalyticsResourceState } from "@/lib/use-analytics";
import { STATUS_COLOR } from "@/lib/analytics-ui";
import { formatBucket, formatCount, formatLatency } from "@/lib/format";
import { Widget } from "./widget";

/**
 * Main chart (Feature 5, Part C §3): queries over time as a stacked area by
 * status (success / no-results / rate-limited / error) with a p95 latency line
 * on a secondary axis. Colors come from the shared status tokens so they match
 * every other widget; both axes, the legend, and tooltips are theme-aware.
 */

const chartConfig = {
  success: { label: "Success", color: STATUS_COLOR.success },
  noResults: { label: "No results", color: STATUS_COLOR.no_results },
  rateLimited: { label: "Rate limited", color: STATUS_COLOR.rate_limited },
  error: { label: "Error", color: STATUS_COLOR.error },
  p95: { label: "p95 latency", color: "var(--foreground)" },
} satisfies ChartConfig;

// Stacking order bottom → top.
const STACK: { key: "success" | "noResults" | "rateLimited" | "error" }[] = [
  { key: "success" },
  { key: "noResults" },
  { key: "rateLimited" },
  { key: "error" },
];

export function QueriesOverTime({
  state,
}: {
  state: AnalyticsResourceState<TimeseriesResponse>;
}) {
  const rows = useMemo(() => {
    if (!state.data) return [];
    const { granularity, points } = state.data;
    return points.map((p) => ({
      label: formatBucket(p.bucket, granularity),
      success: p.success,
      noResults: p.noResults,
      rateLimited: p.rateLimited,
      error: p.error,
      p95: p.p95LatencyMs,
    }));
  }, [state.data]);

  return (
    <Widget
      title="Queries over time"
      description="Volume by outcome, with p95 latency"
      icon={<ActivityIcon className="size-4 text-muted-foreground" />}
      state={state}
      isEmpty={(d) =>
        d.points.every(
          (p) => p.success + p.error + p.rateLimited + p.noResults === 0,
        )
      }
      emptyMessage="No queries yet"
      emptyHint="Run a query from the playground to see it here."
      skeleton={<Skeleton className="h-[300px] w-full" />}
    >
      {() => (
        <ChartContainer config={chartConfig} className="aspect-auto h-[300px] w-full">
          <ComposedChart data={rows} margin={{ left: 4, right: 4, top: 8 }}>
            <defs>
              {STACK.map(({ key }) => (
                <linearGradient
                  key={key}
                  id={`fill-${key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={`var(--color-${key})`}
                    stopOpacity={0.7}
                  />
                  <stop
                    offset="95%"
                    stopColor={`var(--color-${key})`}
                    stopOpacity={0.1}
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              className="text-[0.7rem]"
            />
            <YAxis
              yAxisId="count"
              tickLine={false}
              axisLine={false}
              width={36}
              tickFormatter={(v: number) => formatCount(v)}
              className="text-[0.7rem]"
              allowDecimals={false}
            />
            <YAxis
              yAxisId="latency"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => formatLatency(v)}
              className="text-[0.7rem]"
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelKey="label"
                  formatter={(value, name) => (
                    <TooltipRow name={String(name)} value={Number(value)} />
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {STACK.map(({ key }) => (
              <Area
                key={key}
                yAxisId="count"
                dataKey={key}
                name={key}
                type="monotone"
                stackId="status"
                stroke={`var(--color-${key})`}
                fill={`url(#fill-${key})`}
                strokeWidth={1.5}
                isAnimationActive
                animationDuration={400}
              />
            ))}
            <Line
              yAxisId="latency"
              dataKey="p95"
              name="p95"
              type="monotone"
              stroke="var(--color-p95)"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive
              animationDuration={400}
            />
          </ComposedChart>
        </ChartContainer>
      )}
    </Widget>
  );
}

/** Tooltip cell: latency for the p95 series, counts for the status series. */
function TooltipRow({ name, value }: { name: string; value: number }) {
  const isLatency = name === "p95";
  const label =
    chartConfig[name as keyof typeof chartConfig]?.label ?? name;
  return (
    <div className="flex flex-1 items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span
          className="size-2 rounded-[2px]"
          style={{ backgroundColor: `var(--color-${name})` }}
        />
        {label}
      </span>
      <span className="font-mono font-medium tabular-nums text-foreground">
        {isLatency ? formatLatency(value) : formatCount(value)}
      </span>
    </div>
  );
}

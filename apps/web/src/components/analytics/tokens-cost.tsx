"use client";

import { useMemo } from "react";
import { CoinsIcon } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
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
import { COST_COLOR, TOKENS_COLOR } from "@/lib/analytics-ui";
import { formatBucket, formatCost, formatCount } from "@/lib/format";
import { Widget } from "./widget";

/**
 * Token usage + estimated cost over time (Feature 5, Part C §5). Tokens as a
 * filled area (left axis), cost as a line (right axis) — sharing the same time
 * buckets as the main chart.
 */

const chartConfig = {
  tokens: { label: "Tokens", color: TOKENS_COLOR },
  cost: { label: "Est. cost", color: COST_COLOR },
} satisfies ChartConfig;

export function TokensCostChart({
  state,
}: {
  state: AnalyticsResourceState<TimeseriesResponse>;
}) {
  const rows = useMemo(() => {
    if (!state.data) return [];
    const { granularity, points } = state.data;
    return points.map((p) => ({
      label: formatBucket(p.bucket, granularity),
      tokens: p.tokens,
      cost: p.estimatedCost,
    }));
  }, [state.data]);

  return (
    <Widget
      title="Tokens & cost"
      description="Token throughput and estimated spend"
      icon={<CoinsIcon className="size-4 text-muted-foreground" />}
      state={state}
      isEmpty={(d) => d.points.every((p) => p.tokens === 0 && p.estimatedCost === 0)}
      emptyMessage="No token usage yet"
      skeleton={<Skeleton className="h-[240px] w-full" />}
    >
      {() => (
        <ChartContainer config={chartConfig} className="aspect-auto h-[240px] w-full">
          <ComposedChart data={rows} margin={{ left: 4, right: 4, top: 8 }}>
            <defs>
              <linearGradient id="fill-tokens" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-tokens)" stopOpacity={0.6} />
                <stop offset="95%" stopColor="var(--color-tokens)" stopOpacity={0.08} />
              </linearGradient>
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
              yAxisId="tokens"
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v: number) => formatCount(v)}
              className="text-[0.7rem]"
            />
            <YAxis
              yAxisId="cost"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => formatCost(v)}
              className="text-[0.7rem]"
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelKey="label"
                  formatter={(value, name) => (
                    <div className="flex flex-1 items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          className="size-2 rounded-[2px]"
                          style={{ backgroundColor: `var(--color-${name})` }}
                        />
                        {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {name === "cost"
                          ? formatCost(Number(value))
                          : formatCount(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Area
              yAxisId="tokens"
              dataKey="tokens"
              name="tokens"
              type="monotone"
              stroke="var(--color-tokens)"
              fill="url(#fill-tokens)"
              strokeWidth={1.5}
              isAnimationActive
              animationDuration={400}
            />
            <Line
              yAxisId="cost"
              dataKey="cost"
              name="cost"
              type="monotone"
              stroke="var(--color-cost)"
              strokeWidth={2}
              dot={false}
              isAnimationActive
              animationDuration={400}
            />
          </ComposedChart>
        </ChartContainer>
      )}
    </Widget>
  );
}

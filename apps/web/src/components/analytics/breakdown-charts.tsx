"use client";

import { useMemo } from "react";
import { FolderIcon, LayersIcon, PieChartIcon } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import type { BreakdownResponse, UsageEventStatus } from "@rag/shared";
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
import { STAGE_COLOR, STATUS_COLOR, STATUS_LABEL } from "@/lib/analytics-ui";
import { formatCount, formatLatency } from "@/lib/format";
import { Widget } from "./widget";

type BreakdownState = AnalyticsResourceState<BreakdownResponse>;

// --- Latency by pipeline stage (horizontal stacked bar) --------------------

const stageConfig = {
  embed: { label: "Embedding", color: STAGE_COLOR.embed },
  retrieval: { label: "Retrieval", color: STAGE_COLOR.retrieval },
  generation: { label: "Generation", color: STAGE_COLOR.generation },
} satisfies ChartConfig;

export function StageLatencyChart({ state }: { state: BreakdownState }) {
  const rows = useMemo(() => {
    const s = state.data?.stageLatency;
    return [
      {
        name: "Avg query",
        embed: s?.embed ?? 0,
        retrieval: s?.retrieval ?? 0,
        generation: s?.generation ?? 0,
      },
    ];
  }, [state.data]);

  return (
    <Widget
      title="Latency by stage"
      description="Where a query spends its time, on average"
      icon={<LayersIcon className="size-4 text-muted-foreground" />}
      state={state}
      isEmpty={(d) =>
        !d.stageLatency.embed &&
        !d.stageLatency.retrieval &&
        !d.stageLatency.generation
      }
      emptyMessage="No timing data yet"
      skeleton={<Skeleton className="h-[160px] w-full" />}
    >
      {() => (
        <ChartContainer config={stageConfig} className="aspect-auto h-[160px] w-full">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ left: 0, right: 12, top: 4, bottom: 4 }}
          >
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatLatency(v)}
              className="text-[0.7rem]"
            />
            <YAxis type="category" dataKey="name" hide />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <StageTooltipRow
                      name={String(name)}
                      value={Number(value)}
                    />
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {(["embed", "retrieval", "generation"] as const).map((key) => (
              <Bar
                key={key}
                dataKey={key}
                name={key}
                stackId="stage"
                fill={`var(--color-${key})`}
                radius={2}
                isAnimationActive
                animationDuration={400}
              />
            ))}
          </BarChart>
        </ChartContainer>
      )}
    </Widget>
  );
}

function StageTooltipRow({ name, value }: { name: string; value: number }) {
  const label = stageConfig[name as keyof typeof stageConfig]?.label ?? name;
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
        {formatLatency(value)}
      </span>
    </div>
  );
}

// --- Queries by collection (horizontal bar, top N) -------------------------

const TOP_N = 8;
const collectionConfig = {
  count: { label: "Queries", color: "var(--primary)" },
} satisfies ChartConfig;

export function CollectionsBar({ state }: { state: BreakdownState }) {
  const rows = useMemo(
    () =>
      (state.data?.byCollection ?? []).slice(0, TOP_N).map((c) => ({
        label: c.label,
        count: c.count,
      })),
    [state.data],
  );

  return (
    <Widget
      title="Queries by collection"
      description={`Top ${TOP_N} by volume`}
      icon={<FolderIcon className="size-4 text-muted-foreground" />}
      state={state}
      isEmpty={(d) => d.byCollection.length === 0}
      emptyMessage="No collection activity yet"
      skeleton={<Skeleton className="h-[220px] w-full" />}
    >
      {() => (
        <ChartContainer
          config={collectionConfig}
          className="aspect-auto h-[220px] w-full"
        >
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ left: 8, right: 32, top: 4, bottom: 4 }}
          >
            <XAxis type="number" dataKey="count" hide />
            <YAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
              width={110}
              tickFormatter={(v: string) =>
                v.length > 16 ? `${v.slice(0, 15)}…` : v
              }
              className="text-[0.7rem]"
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent nameKey="label" />}
            />
            <Bar
              dataKey="count"
              fill="var(--color-count)"
              radius={4}
              isAnimationActive
              animationDuration={400}
            >
              <LabelList
                dataKey="count"
                position="right"
                className="fill-muted-foreground text-[0.7rem]"
                formatter={(v) => formatCount(Number(v))}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </Widget>
  );
}

// --- Outcome donut ----------------------------------------------------------

export function StatusDonut({ state }: { state: BreakdownState }) {
  const { rows, total } = useMemo(() => {
    const byStatus = state.data?.byStatus ?? [];
    const rows = byStatus.map((s) => ({
      status: s.key as UsageEventStatus,
      label: STATUS_LABEL[s.key as UsageEventStatus] ?? s.key,
      count: s.count,
    }));
    return { rows, total: rows.reduce((sum, r) => sum + r.count, 0) };
  }, [state.data]);

  const config = useMemo<ChartConfig>(() => {
    const c: ChartConfig = {};
    for (const r of rows) {
      c[r.status] = { label: r.label, color: STATUS_COLOR[r.status] };
    }
    return c;
  }, [rows]);

  return (
    <Widget
      title="Outcomes"
      description="Query results by status"
      icon={<PieChartIcon className="size-4 text-muted-foreground" />}
      state={state}
      isEmpty={() => total === 0}
      emptyMessage="No queries yet"
      skeleton={<Skeleton className="mx-auto h-[220px] w-[220px] rounded-full" />}
    >
      {() => (
        <ChartContainer
          config={config}
          className="mx-auto aspect-square h-[220px]"
        >
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  nameKey="status"
                  formatter={(value, name) => (
                    <div className="flex flex-1 items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          className="size-2 rounded-[2px]"
                          style={{ backgroundColor: `var(--color-${name})` }}
                        />
                        {STATUS_LABEL[name as UsageEventStatus] ?? String(name)}
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {formatCount(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Pie
              data={rows}
              dataKey="count"
              nameKey="status"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              strokeWidth={2}
              isAnimationActive
              animationDuration={400}
            >
              {rows.map((r) => (
                <Cell
                  key={r.status}
                  fill={STATUS_COLOR[r.status]}
                  stroke="var(--background)"
                />
              ))}
            </Pie>
            <ChartLegend
              content={<ChartLegendContent nameKey="status" />}
              verticalAlign="bottom"
            />
          </PieChart>
        </ChartContainer>
      )}
    </Widget>
  );
}

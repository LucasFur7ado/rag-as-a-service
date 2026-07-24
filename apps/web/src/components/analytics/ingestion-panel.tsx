"use client";

import {
  FileStackIcon,
  GaugeIcon,
  PackageIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { IngestionStats } from "@rag/shared";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalyticsResourceState } from "@/lib/use-analytics";
import { formatCount, formatLatency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Ingestion panel (Feature 5, Part C §6): small stat cards for the ingestion
 * pipeline — documents processed, average processing time, average chunks per
 * document, and failure rate.
 */
export function IngestionPanel({
  state,
}: {
  state: AnalyticsResourceState<IngestionStats>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageIcon className="size-4 text-muted-foreground" />
          Ingestion
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {state.loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[68px] w-full rounded-lg" />
            ))
          ) : state.error ? (
            <p className="col-span-full text-xs text-destructive">
              Couldn&apos;t load ingestion stats: {state.error}
            </p>
          ) : (
            <>
              <Stat
                icon={<FileStackIcon className="size-4" />}
                label="Documents processed"
                value={formatCount(state.data?.documentsProcessed ?? 0)}
              />
              <Stat
                icon={<GaugeIcon className="size-4" />}
                label="Avg processing time"
                value={formatLatency(state.data?.avgDurationMs)}
              />
              <Stat
                icon={<PackageIcon className="size-4" />}
                label="Avg chunks / doc"
                value={
                  state.data?.avgChunksPerDoc != null
                    ? state.data.avgChunksPerDoc.toFixed(1)
                    : "—"
                }
              />
              <Stat
                icon={<TriangleAlertIcon className="size-4" />}
                label="Failure rate"
                value={formatPercent(state.data?.failureRate ?? 0)}
                emphasis={
                  (state.data?.failureRate ?? 0) > 0.1 ? "bad" : "normal"
                }
              />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
  emphasis = "normal",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  emphasis?: "normal" | "bad";
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          emphasis === "bad" && "text-chart-error",
        )}
      >
        {value}
      </p>
    </div>
  );
}

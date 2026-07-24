"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3Icon } from "lucide-react";
import type { Collection } from "@rag/shared";
import { RequireAuth } from "@/components/require-auth";
import { useApi } from "@/lib/use-api";
import { resolveRange } from "@/lib/analytics-range";
import { clearAnalyticsCache, useAnalyticsResource } from "@/lib/use-analytics";
import { FilterBar, type RangeChange } from "@/components/analytics/filter-bar";
import { KpiCards } from "@/components/analytics/kpi-cards";
import { QueriesOverTime } from "@/components/analytics/queries-over-time";
import {
  CollectionsBar,
  StageLatencyChart,
  StatusDonut,
} from "@/components/analytics/breakdown-charts";
import { TokensCostChart } from "@/components/analytics/tokens-cost";
import { IngestionPanel } from "@/components/analytics/ingestion-panel";
import { RecentQueries } from "@/components/analytics/recent-queries";

/**
 * Analytics dashboard (`/dashboard/analytics`). Client-rendered (static
 * export): filter selections live in the URL query string, so the view is
 * shareable and survives refresh. Every widget fetches independently with its
 * own loading/error state; a lightweight client cache dedupes identical ranges.
 */
export default function AnalyticsPage() {
  return (
    <RequireAuth>
      <Suspense
        fallback={
          <div className="mx-auto max-w-6xl px-4 py-12 text-sm text-muted-foreground">
            Loading…
          </div>
        }
      >
        <Analytics />
      </Suspense>
    </RequireAuth>
  );
}

function Analytics() {
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Manual-refresh nonce: bumping it (after clearing the cache) forces every
  // widget to refetch its current range.
  const [nonce, setNonce] = useState(0);

  const rangeParam = searchParams.get("range");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const collectionId = searchParams.get("collectionId") ?? undefined;

  // Resolve `now` once per distinct param set (and per manual refresh) so the
  // range — and therefore the widget cache keys — stay stable between renders.
  const range = useMemo(
    () => resolveRange(rangeParam, fromParam, toParam),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeParam, fromParam, toParam, nonce],
  );
  const { from, to } = range;

  // --- Collections (for the filter + table labels) -------------------------
  const [collections, setCollections] = useState<Collection[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .listCollections()
      .then((cols) => !cancelled && setCollections(cols))
      .catch(() => !cancelled && setCollections([]));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const collectionName = useCallback(
    (id: string | null): string => {
      if (!id) return "—";
      return collections?.find((c) => c.id === id)?.name ?? "(deleted)";
    },
    [collections],
  );

  // --- URL writers ---------------------------------------------------------
  const writeParams = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const onRangeChange = useCallback(
    (change: RangeChange) => {
      if (change.preset === "custom" && change.from != null && change.to != null) {
        writeParams({
          range: "custom",
          from: String(change.from),
          to: String(change.to),
        });
      } else {
        writeParams({ range: change.preset, from: undefined, to: undefined });
      }
    },
    [writeParams],
  );

  const onCollectionChange = useCallback(
    (id: string | undefined) => writeParams({ collectionId: id }),
    [writeParams],
  );

  const onRefresh = useCallback(() => {
    clearAnalyticsCache();
    setNonce((n) => n + 1);
  }, []);

  // --- Per-widget resources (fetched in parallel, each isolated) -----------
  const filters = { from, to, collectionId };
  const cacheKey = (name: string) =>
    `${name}|${from}|${to}|${collectionId ?? ""}|${nonce}`;

  const summary = useAnalyticsResource(cacheKey("summary"), () =>
    api.getAnalyticsSummary(filters),
  );
  const timeseries = useAnalyticsResource(cacheKey("timeseries"), () =>
    api.getAnalyticsTimeseries(filters),
  );
  const breakdown = useAnalyticsResource(cacheKey("breakdown"), () =>
    api.getAnalyticsBreakdown(filters),
  );
  const ingestion = useAnalyticsResource(cacheKey("ingestion"), () =>
    api.getAnalyticsIngestion(filters),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {/* Header bar */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold">
            <BarChart3Icon className="size-5 text-primary" />
            Analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            Usage across queries and ingestion for your tenant.
          </p>
        </div>
      </div>

      <div className="mb-6">
        <FilterBar
          range={range}
          collectionId={collectionId}
          collections={collections}
          onRangeChange={onRangeChange}
          onCollectionChange={onCollectionChange}
          onRefresh={onRefresh}
        />
      </div>

      {/* KPI cards */}
      <div className="mb-6">
        <KpiCards summary={summary} timeseries={timeseries} />
      </div>

      {/* Main chart */}
      <div className="mb-6">
        <QueriesOverTime state={timeseries} />
      </div>

      {/* Secondary row */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <StageLatencyChart state={breakdown} />
        <CollectionsBar state={breakdown} />
      </div>

      {/* Third row */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <StatusDonut state={breakdown} />
        <TokensCostChart state={timeseries} />
      </div>

      {/* Ingestion panel */}
      <div className="mb-6">
        <IngestionPanel state={ingestion} />
      </div>

      {/* Recent queries — remounts on manual refresh to reset pagination. */}
      <RecentQueries
        key={`recent-${nonce}`}
        api={api}
        from={from}
        to={to}
        collectionId={collectionId}
        collectionName={collectionName}
      />
    </div>
  );
}

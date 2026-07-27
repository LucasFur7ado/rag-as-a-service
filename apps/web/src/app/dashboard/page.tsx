"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightIcon, FolderIcon, KeyRoundIcon } from "lucide-react";
import type { Collection } from "@rag/shared";
import { RequireAuth } from "@/components/require-auth";
import { useApi } from "@/lib/use-api";
import { resolveRange } from "@/lib/analytics-range";
import { useAnalyticsResource } from "@/lib/use-analytics";
import { KpiCards } from "@/components/analytics/kpi-cards";
import { TokensCostChart } from "@/components/analytics/tokens-cost";
import { COMPACT_COLUMNS, RecentQueries } from "@/components/analytics/recent-queries";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Client-rendered and client-gated: the static host serves this shell to
// anyone, and <RequireAuth> redirects signed-out visitors to sign-in.
export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}

function DashboardContent() {
  const api = useApi();

  // Fixed 7-day overview window; the full analytics page owns range filtering.
  // Resolved once at mount so the resource cache keys stay stable.
  const range = useMemo(() => resolveRange("7d", null, null), []);
  const { from, to } = range;

  // Collections label the collection field in the recent-queries detail sheet.
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

  const filters = { from, to, collectionId: undefined };
  const summary = useAnalyticsResource(`summary|${from}|${to}`, () =>
    api.getAnalyticsSummary(filters),
  );
  const timeseries = useAnalyticsResource(`timeseries|${from}|${to}`, () =>
    api.getAnalyticsTimeseries(filters),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="mb-6 font-heading text-2xl font-semibold">Dashboard</h1>

      {/* Analytics overview — last 7 days */}
      <div className="mb-6">
        <KpiCards summary={summary} timeseries={timeseries} />
      </div>

      {/* Spend over time beside the per-query drill-down that explains it.
          `items-start` lets each card keep its natural height — the chart is
          fixed at 240px, the table grows with its rows. */}
      <div className="mb-3 grid items-start gap-6 md:grid-cols-2">
        <TokensCostChart state={timeseries} />
        <RecentQueries
          api={api}
          from={from}
          to={to}
          collectionName={collectionName}
          columns={COMPACT_COLUMNS}
        />
      </div>

      <div className="mb-10 flex justify-end">
        <Button
          render={<Link href="/dashboard/analytics/" />}
          variant="outline"
          size="sm"
        >
          View all analytics
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>

      {/* Quick links */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderIcon className="size-4 text-muted-foreground" />
              Collections
            </CardTitle>
            <CardDescription>
              Create collections and upload PDF, text, or Markdown documents.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/dashboard/collections/" />} size="sm">
              Manage collections
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRoundIcon className="size-4 text-muted-foreground" />
              API keys
            </CardTitle>
            <CardDescription>
              Create keys to call the query and document APIs from your own code,
              with per-key rate limits.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/dashboard/api-keys/" />} size="sm">
              Manage API keys
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

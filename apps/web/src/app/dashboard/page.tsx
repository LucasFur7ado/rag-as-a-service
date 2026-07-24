"use client";

import Link from "next/link";
import { BarChart3Icon, FolderIcon, KeyRoundIcon } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
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
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="mb-6 font-heading text-2xl font-semibold">Dashboard</h1>
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3Icon className="size-4 text-muted-foreground" />
              Analytics
            </CardTitle>
            <CardDescription>
              Track query volume, latency, token usage, cost, and ingestion —
              with time-series charts and a drill-down.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/dashboard/analytics/" />} size="sm">
              View analytics
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

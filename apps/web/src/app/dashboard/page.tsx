"use client";

import { useAuth } from "@clerk/react";
import { RequireAuth } from "@/components/require-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  const { userId } = useAuth();

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Dashboard — coming soon</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Collections, documents, and query features will live here. Signed in
            as <code className="font-mono">{userId}</code>.
          </p>
          {/* TODO: dynamic detail views (e.g. a single collection) are
              client-routed via query params — `/dashboard/?collection=<id>` —
              not generateStaticParams: IDs are unknown at build time. */}
        </CardContent>
      </Card>
    </div>
  );
}

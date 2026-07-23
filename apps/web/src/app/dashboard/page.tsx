"use client";

import Link from "next/link";
import { useAuth } from "@clerk/react";
import { FolderIcon } from "lucide-react";
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
  const { userId } = useAuth();

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
            <CardTitle>Query</CardTitle>
            <CardDescription>
              Ask questions over your collections. Coming in a later release.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Signed in as <code className="font-mono">{userId}</code>.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

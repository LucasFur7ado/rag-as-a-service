"use client";

import Link from "next/link";
import { useAuth, SignInButton, UserButton } from "@clerk/react";
import { Button } from "@/components/ui/button";

/** Minimal shared header: brand on the left, auth controls on the right. */
export function SiteHeader() {
  const { isSignedIn } = useAuth();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="font-semibold">
          RAG<span className="text-muted-foreground">aaS</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Button render={<Link href="/docs" />} variant="ghost" size="sm">
            Docs
          </Button>
          {isSignedIn ? (
            <>
              <Button render={<Link href="/dashboard" />} variant="ghost" size="sm">
                Dashboard
              </Button>
              <UserButton />
            </>
          ) : (
            <SignInButton mode="modal">
              <Button size="sm">Sign in</Button>
            </SignInButton>
          )}
        </nav>
      </div>
    </header>
  );
}

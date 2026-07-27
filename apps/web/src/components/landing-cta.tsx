"use client";

import Link from "next/link";
import { useAuth, SignInButton } from "@clerk/react";
import { Button } from "@/components/ui/button";

/** Landing call-to-action that adapts to the visitor's auth state (client-side). */
export function LandingCta() {
  const { isSignedIn } = useAuth();

  return (
    <>
      {isSignedIn ? (
        <Button size="lg" render={<Link href="/dashboard" />}>
          Go to dashboard
        </Button>
      ) : (
        <SignInButton mode="modal">
          <Button size="lg">Get started</Button>
        </SignInButton>
      )}
      <Button size="lg" variant="outline" render={<Link href="/docs" />}>
        View docs
      </Button>
    </>
  );
}

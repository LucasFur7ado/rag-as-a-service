"use client";

import { ClerkLoaded, ClerkLoading, RedirectToSignIn, Show } from "@clerk/react";

/**
 * Client-side route guard for the static export.
 *
 * There is no Next proxy/middleware and no server render, so protection happens
 * entirely in the browser: the page HTML ships to everyone, and this component
 * decides what actually renders once Clerk has resolved the session.
 *
 * Clerk v7 removed the `<SignedIn>` / `<SignedOut>` components in favour of
 * `<Show when="signed-in" | "signed-out">`; this is the current equivalent.
 *
 * NOTE: this hides UI, it does not secure data. The API worker (apps/api) is
 * the real trust boundary — it verifies the Clerk JWT on every request.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ClerkLoading>
        <div className="mx-auto max-w-5xl px-4 py-12 text-sm text-muted-foreground">
          Loading…
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <Show when="signed-in">{children}</Show>
        <Show when="signed-out">
          <RedirectToSignIn />
        </Show>
      </ClerkLoaded>
    </>
  );
}

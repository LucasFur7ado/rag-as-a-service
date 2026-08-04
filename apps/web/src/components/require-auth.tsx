"use client";

import { ClerkLoaded, ClerkLoading, RedirectToSignIn, Show } from "@clerk/react";

/**
 * Client-side route guard.
 *
 * Protection happens in the browser: the dashboard shell renders for everyone,
 * and this component decides what actually appears once Clerk has resolved the
 * session. There is deliberately no Proxy (Next 16's renamed Middleware) doing
 * an optimistic redirect — it would only hide the shell a little sooner and
 * would need a server-side Clerk session this app otherwise has no use for.
 *
 * Clerk v7 removed the `<SignedIn>` / `<SignedOut>` components in favour of
 * `<Show when="signed-in" | "signed-out">`; this is the current equivalent.
 *
 * NOTE: this hides UI, it does not secure data. The API routes under
 * `src/app/api` are the real trust boundary — they verify the Clerk JWT (or an
 * API key) on every request and scope every query to the resolved tenant.
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

"use client";

import { useRouter } from "next/navigation";
import { ClerkProvider } from "@clerk/react";

/**
 * Client-side Clerk provider for the static export.
 *
 * We use `@clerk/react` rather than `@clerk/nextjs` here: the App Router
 * `ClerkProvider` from `@clerk/nextjs` registers Server Actions internally
 * (`dist/esm/app-router/server-actions.js`, keyless mode), and `next build`
 * fails outright with "Server Actions are not supported with static export."
 * `@clerk/react` is the same Clerk core with a pure browser-side provider.
 *
 * `routerPush`/`routerReplace` are wired to the Next router so Clerk's internal
 * navigations use client-side routing instead of full page loads.
 */

// Format-valid placeholder so `next build` prerendering succeeds without real
// credentials. Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY for real auth.
const publishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
  "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk";

// `@clerk/react` does not read Next's NEXT_PUBLIC_CLERK_* URL conventions, so
// the sign-in/sign-up routes are passed explicitly.
const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in";
const signUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl={signInUrl}
      signUpUrl={signUpUrl}
      afterSignOutUrl="/"
      routerPush={(to) => router.push(to)}
      routerReplace={(to) => router.replace(to)}
    >
      {children}
    </ClerkProvider>
  );
}

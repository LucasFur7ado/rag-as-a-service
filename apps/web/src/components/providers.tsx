"use client";

import { useRouter } from "next/navigation";
import { ClerkProvider } from "@clerk/react";
import { ThemeProvider, useTheme } from "next-themes";

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

/**
 * Clerk's prebuilt widgets (<SignIn>, <UserButton>, the sign-in modal) render
 * their own DOM and do not read our Tailwind tokens, so the palette is mirrored
 * here as literal colors — these are the sRGB equivalents of the oklch values in
 * globals.css. Keep the two in sync when the tokens change.
 */
const CLERK_COLORS = {
  light: {
    colorBackground: "#ffffff",
    colorForeground: "#0a0a0a",
    colorMuted: "#f5f5f5",
    colorMutedForeground: "#737373",
    colorInput: "#ffffff",
    colorInputForeground: "#0a0a0a",
    colorBorder: "#e5e5e5",
    colorRing: "#a1a1a1",
    colorPrimary: "#171717",
    colorPrimaryForeground: "#fafafa",
    colorNeutral: "#0a0a0a",
  },
  dark: {
    colorBackground: "#171717",
    colorForeground: "#fafafa",
    colorMuted: "#262626",
    colorMutedForeground: "#a1a1a1",
    colorInput: "#262626",
    colorInputForeground: "#fafafa",
    colorBorder: "#2e2e2e",
    colorRing: "#737373",
    colorPrimary: "#e5e5e5",
    colorPrimaryForeground: "#171717",
    colorNeutral: "#fafafa",
  },
} as const;

/** Inner boundary: reads the theme, so it must sit under <ThemeProvider>. */
function ClerkWithTheme({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl={signInUrl}
      signUpUrl={signUpUrl}
      afterSignOutUrl="/"
      routerPush={(to) => router.push(to)}
      routerReplace={(to) => router.replace(to)}
      appearance={{
        variables: {
          ...CLERK_COLORS[resolvedTheme === "light" ? "light" : "dark"],
          borderRadius: "0.625rem",
          fontFamily: "inherit",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // `class` strategy: next-themes toggles `.dark` on <html>, which is what the
    // `@custom-variant dark` in globals.css keys off. System preference is
    // deliberately not consulted — dark is the product default, and the toggle
    // is a straight two-way switch persisted to localStorage.
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="rag-theme"
    >
      <ClerkWithTheme>{children}</ClerkWithTheme>
    </ThemeProvider>
  );
}

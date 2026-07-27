"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, SignInButton, UserButton } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

/** In-page anchors, only useful on the landing page itself. */
const LANDING_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Pricing", href: "/#pricing" },
];

/** Shared header: brand on the left, section/auth controls on the right. */
export function SiteHeader() {
  const { isSignedIn } = useAuth();
  const pathname = usePathname();
  const onLanding = pathname === "/";

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-semibold">
          RAG<span className="text-muted-foreground">aaS</span>
        </Link>
        <nav className="flex items-center gap-3">
          {onLanding
            ? LANDING_LINKS.map((link) => (
                <Button
                  key={link.href}
                  render={<Link href={link.href} />}
                  variant="ghost"
                  size="sm"
                  className="hidden sm:inline-flex"
                >
                  {link.label}
                </Button>
              ))
            : null}
          <Button render={<Link href="/docs" />} variant="ghost" size="sm">
            Docs
          </Button>
          <ThemeToggle />
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

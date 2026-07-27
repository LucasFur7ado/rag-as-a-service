"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenIcon, MenuIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface NavItem {
  label: string;
  href: string;
}
interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    title: "Getting started",
    items: [
      { label: "Overview", href: "/docs" },
      { label: "Authentication", href: "/docs/authentication" },
      { label: "Rate limits", href: "/docs/rate-limits" },
      { label: "Errors", href: "/docs/errors" },
    ],
  },
  {
    title: "Guides",
    items: [{ label: "Ingesting documents", href: "/docs/guides/ingestion" }],
  },
  {
    title: "Reference",
    items: [{ label: "API reference", href: "/docs/reference" }],
  },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-6">
      {NAV.map((section) => (
        <div key={section.title} className="flex flex-col gap-1">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {section.title}
          </p>
          {section.items.map((item) => {
            const active =
              item.href === "/docs" ? pathname === "/docs" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Docs navigation: sticky rail on desktop, a disclosure sheet on mobile. */
export function DocsSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile trigger */}
      <div className="mb-4 flex items-center justify-between lg:hidden">
        <span className="flex items-center gap-2 text-sm font-medium">
          <BookOpenIcon className="size-4" /> Documentation
        </span>
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? <XIcon className="size-4" /> : <MenuIcon className="size-4" />}
          <span className="ml-1">Menu</span>
        </Button>
      </div>

      {open ? (
        <div className="mb-6 rounded-lg border p-4 lg:hidden">
          <NavLinks onNavigate={() => setOpen(false)} />
        </div>
      ) : null}

      {/* Desktop rail */}
      <aside className="hidden w-52 shrink-0 lg:block">
        <div className="sticky top-20">
          <NavLinks />
        </div>
      </aside>
    </>
  );
}

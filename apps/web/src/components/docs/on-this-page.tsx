"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Heading {
  id: string;
  text: string;
  level: number;
}

/**
 * In-page table of contents (wide screens only). Scans the article's h2/h3
 * headings after mount and tracks the one currently in view.
 */
export function OnThisPage({ className }: { className?: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("article h2[id], article h3[id]"),
    );
    setHeadings(
      nodes.map((n) => ({
        id: n.id,
        text: n.textContent ?? "",
        level: n.tagName === "H3" ? 3 : 2,
      })),
    );

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);

  if (headings.length === 0) return null;

  return (
    <div className={cn("w-56 shrink-0", className)}>
      <div className="sticky top-20">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          On this page
        </p>
        <ul className="flex flex-col gap-1 border-l text-sm">
          {headings.map((h) => (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                className={cn(
                  "-ml-px block border-l-2 py-0.5 transition-colors",
                  h.level === 3 ? "pl-6" : "pl-3",
                  activeId === h.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

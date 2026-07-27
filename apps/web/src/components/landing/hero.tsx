import Link from "next/link";
import { ArrowRightIcon, CircleCheckIcon, SparklesIcon } from "lucide-react";
import { LandingCta } from "@/components/landing-cta";
import { HeroPreview } from "./hero-preview";

/** Short proof points under the CTAs — capability claims, not marketing fluff. */
const HIGHLIGHTS = [
  "PDF, Markdown & plain text",
  "Streamed answers with citations",
  "Tenant-isolated vector search",
];

/**
 * Above-the-fold hero: announcement pill → headline → subhead → CTAs →
 * product preview. The only client island is <LandingCta>, which needs the
 * visitor's auth state.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="relative isolate overflow-hidden">
      {/* Decorative grid, faded with a radial mask. Drawn from --border so it
          follows the light/dark theme instead of a hardcoded colour. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[42rem] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_60%_55%_at_50%_0%,#000_50%,transparent_100%)]"
      />

      <div className="mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 py-16 text-center sm:py-24">
        <Link
          href="/changelog"
          className="group inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        >
          <SparklesIcon className="size-3.5" />
          <span>Usage analytics and the public API are live</span>
          <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>

        <div className="flex max-w-3xl flex-col gap-5">
          <h1
            id="hero-heading"
            className="font-heading text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-6xl"
          >
            Ship retrieval-augmented answers over your own documents.
          </h1>
          <p className="mx-auto max-w-xl text-lg text-pretty text-muted-foreground">
            Multi-tenant ingestion, vector search, and grounded generation behind a
            simple API. Bring your documents; we handle the retrieval.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <LandingCta />
        </div>

        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {HIGHLIGHTS.map((highlight) => (
            <li key={highlight} className="flex items-center gap-1.5">
              <CircleCheckIcon className="size-3.5" aria-hidden />
              {highlight}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex w-full justify-center">
          <HeroPreview />
        </div>
      </div>
    </section>
  );
}

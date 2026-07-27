import { LandingCta } from "@/components/landing-cta";

/** Closing conversion band, immediately above the footer. */
export function CtaBand() {
  return (
    <section aria-labelledby="cta-heading" className="border-t py-16 sm:py-24">
      <div className="mx-auto w-full max-w-5xl px-4">
        <div className="relative isolate overflow-hidden rounded-2xl bg-card px-6 py-14 text-center ring-1 ring-foreground/10 sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_50%_80%_at_50%_0%,color-mix(in_oklch,var(--foreground)_7%,transparent),transparent)]"
          />
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-6">
            <h2
              id="cta-heading"
              className="font-heading text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
            >
              Your documents already have the answers.
            </h2>
            <p className="text-base text-pretty text-muted-foreground">
              Create a collection, upload a file, and ask it something. The whole
              loop takes about a minute — no card, no sales call.
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <LandingCta />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

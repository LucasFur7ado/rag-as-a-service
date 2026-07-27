import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Section, SectionHeading } from "./section";

/**
 * Pricing tiers.
 *
 * NOTE: billing is not implemented yet (no plans, quotas or metering beyond the
 * per-key rate limit), so these amounts and allowances are placeholders — the
 * note above the grid says so explicitly. Update this array, not the markup,
 * when real plans exist.
 */

/** Enterprise enquiries go straight to a mailbox; there is no /contact page. */
const CONTACT_EMAIL = "luc4sfur7ado@gmail.com";
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}`;

const PLANS = [
  {
    name: "Developer",
    price: "$0",
    cadence: "forever",
    blurb: "Enough to build and ship a first integration.",
    cta: { label: "Start building", href: "/sign-up", external: false },
    featured: false,
    features: [
      "3 collections, 100 documents",
      "60 requests / minute per API key",
      "Streamed answers with citations",
      "Full dashboard and playground",
      "Community support",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "annual",
    blurb: "For regulated workloads and dedicated capacity.",
    cta: { label: "Talk to us", href: CONTACT_HREF, external: true },
    featured: false,
    features: [
      "Dedicated namespaces and region pinning",
      "SSO, audit logs and custom retention",
      "Negotiated rate limits and uptime SLA",
      "Security review and DPA",
      "Named support engineer",
    ],
  },
];

export function Pricing() {
  return (
    <Section id="pricing">
      <SectionHeading
        id="pricing"
        eyebrow="Pricing"
        title="Start free, pay when it is carrying traffic"
        description="Billing is not switched on yet — every tier below is free while the platform is in beta, and existing projects keep their allowances when it lands."
      />

      <div className="mx-auto mt-12 grid max-w-3xl items-start gap-4 lg:grid-cols-2">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              "flex h-full flex-col gap-5 rounded-xl bg-card p-6",
              plan.featured
                ? "ring-2 ring-foreground/25 lg:-mt-3 lg:pb-9"
                : "ring-1 ring-foreground/10",
            )}
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-heading text-base font-medium">{plan.name}</h3>
                {plan.featured ? <Badge variant="secondary">Most popular</Badge> : null}
              </div>
              <p className="flex items-baseline gap-1.5">
                <span className="font-heading text-3xl font-semibold tracking-tight">
                  {plan.price}
                </span>
                <span className="text-sm text-muted-foreground">{plan.cadence}</span>
              </p>
              <p className="text-sm text-pretty text-muted-foreground">{plan.blurb}</p>
            </div>

            <Button
              className="w-full"
              variant={plan.featured ? "default" : "outline"}
              render={
                plan.cta.external ? (
                  <a href={plan.cta.href} />
                ) : (
                  <Link href={plan.cta.href} />
                )
              }
            >
              {plan.cta.label}
            </Button>

            <ul className="flex flex-col gap-2.5 text-sm">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <CheckIcon
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="text-pretty text-muted-foreground">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Need something in between?{" "}
        <a href={CONTACT_HREF} className="underline underline-offset-4 hover:text-foreground">
          Tell us about your workload
        </a>
        .
      </p>
    </Section>
  );
}

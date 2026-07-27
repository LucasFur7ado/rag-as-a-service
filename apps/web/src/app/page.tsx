import type { Metadata } from "next";
import { Hero } from "@/components/landing/hero";
import { TechStrip } from "@/components/landing/tech-strip";
import { Features } from "@/components/landing/features";
import { HowItWorks } from "@/components/landing/how-it-works";
import { CodeShowcase } from "@/components/landing/code-showcase";
import { UseCases } from "@/components/landing/use-cases";
import { Pricing } from "@/components/landing/pricing";
import { Faq } from "@/components/landing/faq";
import { CtaBand } from "@/components/landing/cta-band";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "RAG as a Service — grounded answers over your own documents",
  description:
    "Multi-tenant ingestion, vector search and grounded generation behind a simple API. Upload documents, ask questions, get answers with verifiable citations.",
};

/**
 * Marketing landing page. Statically renderable end to end — the only client
 * islands are the auth-dependent CTAs, the FAQ accordion and the code-sample
 * tabs; syntax highlighting runs at build time.
 */
export default function Home() {
  return (
    <>
      <Hero />
      <TechStrip />
      <Features />
      <HowItWorks />
      <CodeShowcase />
      <UseCases />
      <Pricing />
      <Faq />
      <CtaBand />
      <SiteFooter />
    </>
  );
}

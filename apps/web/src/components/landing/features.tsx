import {
  BadgeCheckIcon,
  BracesIcon,
  ChartColumnIncreasingIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  WorkflowIcon,
  ZapIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Section, SectionHeading } from "./section";

interface Feature {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /** Column span at `md` and up — drives the bento rhythm. */
  span: string;
  /** Optional monospace detail rendered under the copy. */
  detail?: string;
}

const FEATURES: Feature[] = [
  {
    icon: WorkflowIcon,
    title: "Durable ingestion pipeline",
    body:
      "Upload a PDF, Markdown or text file and get an immediate response. A Cloudflare Workflow then parses, chunks, embeds and upserts it — every phase retried with exponential backoff, every vector id deterministic so re-runs overwrite instead of duplicating.",
    detail: "extract → chunk → embed → upsert → ready",
    span: "md:col-span-4",
  },
  {
    icon: BadgeCheckIcon,
    title: "Answers you can audit",
    body:
      "Generation is grounded strictly in retrieved chunks. Emitted [n] markers are resolved back to real sources — with filename, page and score — and anything the model invents is dropped before you ever see it.",
    span: "md:col-span-2",
  },
  {
    icon: ShieldCheckIcon,
    title: "Tenant isolation by default",
    body:
      "Vectors live in a per-tenant, per-collection namespace and every query is filtered by tenant. Another tenant's resources return 404, never a 403 that would leak their existence.",
    span: "md:col-span-2",
  },
  {
    icon: KeyRoundIcon,
    title: "API keys and rate limits",
    body:
      "Mint scoped keys from the dashboard, shown once and stored hashed. Traffic is metered per key by an atomic Durable Object with RateLimit-* headers on every response.",
    span: "md:col-span-2",
  },
  {
    icon: ChartColumnIncreasingIcon,
    title: "Usage analytics built in",
    body:
      "Queries over time, p95 latency, tokens and cost, plus a failure breakdown across rate limits, empty retrievals and provider errors — no extra instrumentation.",
    span: "md:col-span-2",
  },
  {
    icon: ZapIcon,
    title: "Streaming or single-shot",
    body:
      "Server-Sent Events by default, so tokens render as they are generated and citations arrive when generation completes. Pass stream: false for one JSON payload that is trivial to evaluate offline.",
    span: "md:col-span-3",
  },
  {
    icon: BracesIcon,
    title: "An OpenAPI 3.1 contract",
    body:
      "Every endpoint is generated from the spec, served at /v1/openapi.json, and explorable from a Try it console in the docs. Generate a client in whatever language you ship.",
    span: "md:col-span-3",
  },
];

export function Features() {
  return (
    <Section id="features">
      <SectionHeading
        id="features"
        eyebrow="Platform"
        title="Everything between a raw document and a cited answer"
        description="The unglamorous parts of a RAG stack — parsing, chunking, embedding, isolation, retries, metering — already built and running in production."
      />

      <div className="mt-12 grid gap-4 md:grid-cols-6">
        {FEATURES.map((feature) => (
          <article
            key={feature.title}
            className={cn(
              "group flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10 transition-shadow hover:shadow-md",
              feature.span,
            )}
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground">
              <feature.icon className="size-4.5" />
            </span>
            <h3 className="font-heading text-base font-medium">{feature.title}</h3>
            <p className="text-sm text-pretty text-muted-foreground">{feature.body}</p>
            {feature.detail ? (
              <p className="mt-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
                {feature.detail}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </Section>
  );
}

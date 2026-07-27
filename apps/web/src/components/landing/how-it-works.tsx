import Link from "next/link";
import { ArrowRightIcon, MessageSquareQuoteIcon, SearchIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section, SectionHeading } from "./section";

const STEPS = [
  {
    icon: UploadIcon,
    title: "Create a collection and upload",
    body:
      "Group documents into collections — one per product, customer or knowledge base. Upload PDF, Markdown or plain text up to 25 MB; the call returns immediately.",
    code: "POST /v1/collections/:id/documents",
  },
  {
    icon: SearchIcon,
    title: "Ingestion runs itself",
    body:
      "Text is extracted (page numbers intact), split into overlapping chunks, embedded with BGE-M3 and upserted into your namespace. Watch status go processing → ready in the dashboard.",
    code: "GET /v1/documents/:id/status",
  },
  {
    icon: MessageSquareQuoteIcon,
    title: "Ask, and get cited answers",
    body:
      "Your question is embedded with the same model, retrieved against your namespace, assembled into a bounded context and answered — streamed token by token with validated citations.",
    code: "POST /v1/collections/:id/query",
  },
];

export function HowItWorks() {
  return (
    <Section id="how-it-works" className="bg-muted/30">
      <SectionHeading
        id="how-it-works"
        eyebrow="How it works"
        title="Three calls from a stack of PDFs to a grounded answer"
        description="No pipelines to orchestrate, no vector database to operate, no prompt scaffolding to maintain."
      />

      <ol className="mt-12 grid gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="relative flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <step.icon className="size-4.5" />
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                Step {index + 1}
              </span>
            </div>
            <h3 className="font-heading text-base font-medium">{step.title}</h3>
            <p className="text-sm text-pretty text-muted-foreground">{step.body}</p>
            <code className="mt-auto block truncate rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
              {step.code}
            </code>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex justify-center">
        <Button variant="outline" render={<Link href="/docs/guides/ingestion" />}>
          Read the ingestion guide
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </Section>
  );
}

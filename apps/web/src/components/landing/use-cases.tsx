import Link from "next/link";
import { ArrowRightIcon, BotIcon, LayersIcon, ScaleIcon, LifeBuoyIcon } from "lucide-react";
import { Section, SectionHeading } from "./section";

const USE_CASES = [
  {
    icon: LifeBuoyIcon,
    title: "Support copilots",
    body: "Answer from your help centre and policy docs, with the source article attached to every reply so agents can verify before they send.",
    href: "/use-cases/support",
  },
  {
    icon: LayersIcon,
    title: "Internal knowledge bases",
    body: "Handbooks, runbooks and postmortems become searchable in plain language — scoped per team, so nobody sees a collection they were not granted.",
    href: "/use-cases/knowledge-base",
  },
  {
    icon: BotIcon,
    title: "Product documentation search",
    body: "Drop a query box into your docs and return answers with deep links, instead of ten keyword matches the reader still has to skim.",
    href: "/use-cases/docs-search",
  },
  {
    icon: ScaleIcon,
    title: "Contract and research review",
    body: "Interrogate long PDFs at page-level precision. Citations carry the page number, so every answer is one click from the paragraph behind it.",
    href: "/use-cases/research",
  },
];

export function UseCases() {
  return (
    <Section id="use-cases" className="bg-muted/30">
      <SectionHeading
        id="use-cases"
        eyebrow="Use cases"
        title="Built for anywhere the answer already exists in a document"
        description="Same API, same isolation guarantees — the collection you point it at is the only thing that changes."
      />

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {USE_CASES.map((useCase) => (
          <Link
            key={useCase.href}
            href={useCase.href}
            className="group flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10 transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <useCase.icon className="size-4.5" />
              </span>
              <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
            <h3 className="font-heading text-base font-medium">{useCase.title}</h3>
            <p className="text-sm text-pretty text-muted-foreground">{useCase.body}</p>
          </Link>
        ))}
      </div>
    </Section>
  );
}

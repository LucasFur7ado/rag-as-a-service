import Link from "next/link";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Section, SectionHeading } from "./section";

const FAQS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "What file formats can I upload?",
    a: (
      <p>
        PDF, Markdown and plain text, up to 25 MB per file. Page numbers survive
        extraction, so a citation from a PDF points at the page the sentence came
        from — not just the document.
      </p>
    ),
  },
  {
    q: "How do you stop one tenant from seeing another tenant's data?",
    a: (
      <p>
        Every vector lives in a namespace derived from the tenant and collection,
        and every query is additionally filtered by tenant id. A resource owned by
        someone else returns <code>404</code> rather than <code>403</code>, so the
        API never confirms that it exists.
      </p>
    ),
  },
  {
    q: "What happens when the model invents a citation?",
    a: (
      <p>
        Markers are resolved against the chunks that were actually retrieved.
        Anything that does not map to a real chunk is stripped from the answer and
        reported back in <code>usage.invalidMarkers</code>, so you can alert on it
        instead of discovering it in a screenshot.
      </p>
    ),
  },
  {
    q: "Can I stream responses?",
    a: (
      <p>
        Yes — streaming is the default. The endpoint returns Server-Sent Events:
        zero or more <code>delta</code> events, then one <code>sources</code>{" "}
        event with citations and usage, then <code>done</code>. Send{" "}
        <code>{`"stream": false`}</code> when you would rather have a single JSON
        payload.
      </p>
    ),
  },
  {
    q: "How are rate limits enforced?",
    a: (
      <p>
        Per key, per minute, counted atomically by a Durable Object — 60 requests
        a minute by default and overridable per key. Every response carries{" "}
        <code>RateLimit-*</code> headers, and a 429 includes{" "}
        <code>Retry-After</code>. See{" "}
        <Link href="/docs/rate-limits">the rate limits guide</Link>.
      </p>
    ),
  },
  {
    q: "Which models power retrieval and generation?",
    a: (
      <p>
        Embeddings use BGE-M3 on Workers AI (1024-dimensional, cosine), and answers
        are generated with Llama 3.3 70B. Queries are embedded with the exact model
        used at ingestion time, so retrieval stays consistent.
      </p>
    ),
  },
  {
    q: "Do I have to run any infrastructure?",
    a: (
      <p>
        No. The API is a Cloudflare Worker and the dashboard is a static SPA. You
        bring documents and an API key; there is no cluster, queue or vector
        database for you to operate.
      </p>
    ),
  },
];

export function Faq() {
  return (
    <Section id="faq" className="bg-muted/30">
      <SectionHeading
        id="faq"
        eyebrow="FAQ"
        title="Questions people ask before they integrate"
        description={
          <>
            Everything else lives in <Link href="/docs" className="underline underline-offset-4 hover:text-foreground">the documentation</Link>.
          </>
        }
      />

      <div className="mx-auto mt-10 max-w-3xl">
        <Accordion className="rounded-xl bg-card px-5 ring-1 ring-foreground/10">
          {FAQS.map((faq) => (
            <AccordionItem key={faq.q} value={faq.q}>
              <AccordionTrigger className="py-4 text-base">{faq.q}</AccordionTrigger>
              <AccordionContent className="pb-4 text-muted-foreground">
                {faq.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  );
}

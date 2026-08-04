import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { DocsArticle } from "@/components/docs/docs-article";
import { CodeBlock } from "@/components/docs/code-block";
import { API_BASE_URL } from "@/lib/docs-config";
import { spec } from "@/lib/openapi";

export const metadata = {
  title: "Overview — RAG as a Service Docs",
  description: "What the RAG as a Service API does, its base URL, and a 60-second quickstart.",
};

const CARDS = [
  { href: "/docs/authentication", title: "Authentication", body: "Session vs API key, headers, and 401s." },
  { href: "/docs/rate-limits", title: "Rate limits", body: "The limit, RateLimit-* headers, and backoff." },
  { href: "/docs/errors", title: "Errors", body: "The error schema and every status code." },
  { href: "/docs/reference", title: "API reference", body: "Every endpoint, generated from the spec." },
];

export default function DocsOverviewPage() {
  return (
    <DocsArticle>
      <h1>RAG as a Service API</h1>
      <p className="lead">
        Upload documents into collections, then ask grounded questions and get answers with
        citations. This is the developer reference for the HTTP API — version {spec.info.version}.
      </p>

      <h2 id="base-url">Base URL</h2>
      <p>All endpoints are served under a single base URL:</p>
      <CodeBlock code={API_BASE_URL} lang="bash" />
      <p>
        The machine-readable contract is available as{" "}
        <Link href="/docs/reference">an OpenAPI 3.1 document</Link> at{" "}
        <code>/v1/openapi.json</code> (and <code>/v1/openapi.yaml</code>).
      </p>

      <h2 id="quickstart">60-second quickstart</h2>
      <p>
        <strong>1. Create an API key.</strong> From the dashboard, open{" "}
        <Link href="/dashboard/api-keys">API keys</Link> and create one. Copy it immediately — the
        plaintext key is shown exactly once.
      </p>
      <p>
        <strong>2. Ask a question.</strong> Point a request at a collection that has at least one
        ready document. Use <code>{`"stream": false`}</code> for a single JSON answer (drop it for a
        streamed Server-Sent Events response):
      </p>
      <CodeBlock
        lang="bash"
        code={`curl -X POST '${API_BASE_URL}/v1/collections/col_9f8b2a1c/query' \\
  -H 'Authorization: Bearer rag_live_YOUR_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{"query":"What is the refund policy for annual plans?","stream":false}'`}
      />
      <p>
        <strong>3. Read the response.</strong> The answer contains inline <code>[n]</code> markers
        that map to the <code>sources</code> array:
      </p>
      <CodeBlock
        lang="json"
        code={`{
  "answer": "Annual plans can be refunded in full within 30 days of purchase [1].",
  "sources": [
    {
      "marker": 1,
      "documentId": "doc_4c1e77a0",
      "filename": "handbook.pdf",
      "page": 12,
      "snippet": "Annual plans are eligible for a full refund within 30 days…",
      "score": 0.82,
      "cited": true
    }
  ],
  "usage": { "chunksRetrieved": 8, "chunksUsed": 5, "contextTokens": 1240, "invalidMarkers": [], "model": "gemini-2.5-flash" }
}`}
      />
      <p>
        Prefer to explore interactively? The{" "}
        <Link href="/docs/reference">API reference</Link> has a “Try it” console on every endpoint.
      </p>

      <h2 id="explore">Explore</h2>
      <div className="not-prose grid gap-3 sm:grid-cols-2">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex flex-col rounded-lg border p-4 no-underline transition-colors hover:bg-accent/50"
          >
            <span className="flex items-center justify-between font-medium text-foreground">
              {card.title}
              <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="mt-1 text-sm text-muted-foreground">{card.body}</span>
          </Link>
        ))}
      </div>
    </DocsArticle>
  );
}

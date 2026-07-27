import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import {
  CodeSamplesTabs,
  type EndpointSamples,
} from "@/components/docs/code-samples-tabs";
import { CodeBlock } from "@/components/docs/code-block";
import { API_BASE_URL, API_KEY_PLACEHOLDER } from "@/lib/docs-config";
import { highlight } from "@/lib/shiki";
import { Section, SectionHeading } from "./section";

const CURL = `curl -X POST '${API_BASE_URL}/v1/collections/col_9f8b2a1c/query' \\
  -H 'Authorization: Bearer ${API_KEY_PLACEHOLDER}' \\
  -H 'Content-Type: application/json' \\
  -d '{"query":"What is the refund policy for annual plans?","stream":false}'`;

const TS = `const res = await fetch(
  "${API_BASE_URL}/v1/collections/col_9f8b2a1c/query",
  {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.RAG_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "What is the refund policy for annual plans?",
      stream: false,
    }),
  },
);

const { answer, sources } = await res.json();`;

const PYTHON = `import os, requests

res = requests.post(
    "${API_BASE_URL}/v1/collections/col_9f8b2a1c/query",
    headers={"Authorization": f"Bearer {os.environ['RAG_API_KEY']}"},
    json={
        "query": "What is the refund policy for annual plans?",
        "stream": False,
    },
)

answer, sources = res.json()["answer"], res.json()["sources"]`;

const RESPONSE = `{
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
  "usage": {
    "chunksRetrieved": 8,
    "chunksUsed": 5,
    "contextTokens": 1240,
    "invalidMarkers": []
  }
}`;

/**
 * Request/response showcase. Highlighting runs at build time inside this async
 * Server Component (see lib/shiki.ts), so no highlighter reaches the browser —
 * the language tabs are the only client island.
 */
export async function CodeShowcase() {
  const [curlHtml, tsHtml, pythonHtml] = await Promise.all([
    highlight(CURL, "bash"),
    highlight(TS, "ts"),
    highlight(PYTHON, "python"),
  ]);

  const samples: EndpointSamples = {
    curl: { html: curlHtml, raw: CURL },
    ts: { html: tsHtml, raw: TS },
    python: { html: pythonHtml, raw: PYTHON },
  };

  return (
    <Section id="api">
      <SectionHeading
        id="api"
        eyebrow="Developer experience"
        title="One endpoint. Every answer carries its receipts."
        description="Authenticate with an API key, point at a collection, and read back an answer whose every claim maps to a chunk you uploaded."
      />

      <div className="mt-12 grid items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Request
          </h3>
          <CodeSamplesTabs samples={samples} />
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Response
          </h3>
          <CodeBlock code={RESPONSE} lang="json" className="my-0" />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
        <Link
          href="/docs"
          className="group inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          60-second quickstart
          <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link
          href="/docs/reference"
          className="group inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          Full API reference
          <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link
          href="/docs/authentication"
          className="group inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          Authentication
          <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </Section>
  );
}

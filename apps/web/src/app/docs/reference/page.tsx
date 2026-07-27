import { API_BASE_URL } from "@/lib/docs-config";
import { listOperations } from "@/lib/openapi";
import { buildRequestModel, curlFor, tsFor, pythonFor } from "@/lib/code-samples";
import { highlight } from "@/lib/shiki";
import { ReferenceExplorer } from "@/components/docs/reference-explorer";
import type { EndpointSamples } from "@/components/docs/code-samples-tabs";

export const metadata = {
  title: "API reference — RAG as a Service Docs",
  description: "Every endpoint, generated from the OpenAPI spec, with code samples and a Try it console.",
};

/**
 * The reference is generated entirely from the embedded OpenAPI spec (see
 * @/lib/openapi). Here — at static-export build time — we generate and
 * syntax-highlight the curl/TypeScript/Python samples for every operation and
 * hand them to the interactive explorer, so no highlighter ships to the client.
 */
export default async function ReferencePage() {
  const ops = listOperations();
  const samples: Record<string, EndpointSamples> = {};

  for (const op of ops) {
    const model = buildRequestModel(op, API_BASE_URL);
    const curl = curlFor(model);
    const ts = tsFor(model);
    const python = pythonFor(model);
    samples[op.anchor] = {
      curl: { raw: curl, html: await highlight(curl, "bash") },
      ts: { raw: ts, html: await highlight(ts, "ts") },
      python: { raw: python, html: await highlight(python, "python") },
    };
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">API reference</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generated from the OpenAPI 3.1 spec. Pick an endpoint to see its parameters, schemas, code
          samples, and a live “Try it” console.
        </p>
      </header>
      <ReferenceExplorer samples={samples} baseUrl={API_BASE_URL} />
    </div>
  );
}

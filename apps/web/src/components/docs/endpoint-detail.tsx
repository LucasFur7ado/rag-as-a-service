"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { LinkIcon, TerminalIcon } from "lucide-react";
import type { Operation, ResponseObject } from "@/lib/openapi";
import { authLabel } from "@/lib/openapi";
import { MethodBadge } from "./method-badge";
import { SchemaViewer } from "./schema-viewer";
import { CodeSamplesTabs, type EndpointSamples } from "./code-samples-tabs";
import { TryItConsole } from "./try-it-console";
import { CopyButton } from "./copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function statusTone(code: string): string {
  const n = Number(code);
  if (n < 300) return "text-chart-success";
  if (n < 400) return "text-chart-embed";
  if (n < 500) return "text-chart-rate-limited";
  return "text-chart-error";
}

function ResponseRow({ code, response }: { code: string; response: ResponseObject }) {
  const schema =
    response.content?.["application/json"]?.schema ??
    Object.values(response.content ?? {})[0]?.schema;
  const headerNames = Object.keys(response.headers ?? {});
  return (
    <details className="rounded-md border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
        <span className={cn("font-mono text-sm font-semibold", statusTone(code))}>{code}</span>
        <span className="text-sm text-muted-foreground">{response.description}</span>
      </summary>
      <div className="space-y-3 border-t px-3 py-3">
        {headerNames.length ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Headers</p>
            <ul className="space-y-0.5">
              {headerNames.map((h) => (
                <li key={h} className="text-xs">
                  <span className="font-mono text-foreground">{h}</span>
                  {response.headers?.[h]?.description ? (
                    <span className="text-muted-foreground"> — {response.headers[h].description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {schema ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Body</p>
            <SchemaViewer schema={schema} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No response body.</p>
        )}
      </div>
    </details>
  );
}

/** Full detail view for a single operation. */
export function EndpointDetail({
  op,
  samples,
  baseUrl,
}: {
  op: Operation;
  samples: EndpointSamples;
  baseUrl: string;
}) {
  const [tryOpen, setTryOpen] = useState(false);
  const auth = authLabel(op);
  const pathParams = op.parameters.filter((p) => p.in === "path");
  const queryParams = op.parameters.filter((p) => p.in === "query");
  const bodyContent = op.requestBody?.content ?? {};
  const bodyType = Object.keys(bodyContent)[0];
  const bodySchema = bodyContent[bodyType]?.schema;

  return (
    <section id={op.anchor} className="scroll-mt-20">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <MethodBadge method={op.method} />
        <code className="font-mono text-sm break-all">{op.path}</code>
        <a
          href={`#${op.anchor}`}
          aria-label="Link to this endpoint"
          className="text-muted-foreground hover:text-foreground"
        >
          <LinkIcon className="size-3.5" />
        </a>
      </div>
      {op.summary ? <h2 className="mt-2 text-xl font-semibold">{op.summary}</h2> : null}

      {/* Auth */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {auth.schemes.length ? (
          auth.schemes.map((s) => (
            <Badge key={s} variant="outline">
              {s === "ApiKeyAuth" ? "API key" : s === "SessionAuth" ? "Session" : s}
            </Badge>
          ))
        ) : (
          <Badge variant="outline">Public</Badge>
        )}
      </div>

      {/* Description */}
      {op.description ? (
        <div className="mt-3 text-sm text-muted-foreground [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:mt-1">
          <ReactMarkdown>{op.description}</ReactMarkdown>
        </div>
      ) : null}

      {/* Parameters */}
      {pathParams.length || queryParams.length ? (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Parameters</h3>
          <div className="divide-y divide-border/60 rounded-md border px-3">
            {[...pathParams, ...queryParams].map((p) => (
              <div key={`${p.in}-${p.name}`} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                <span className="font-mono text-sm font-medium">{p.name}</span>
                <span className="text-[10px] uppercase text-muted-foreground">{p.in}</span>
                {p.required ? (
                  <span className="text-[10px] font-semibold uppercase text-chart-error">required</span>
                ) : null}
                {p.description ? (
                  <span className="w-full text-xs text-muted-foreground sm:flex-1">{p.description}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Request body */}
      {bodySchema ? (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">
            Request body <span className="font-mono text-xs text-muted-foreground">{bodyType}</span>
          </h3>
          <div className="rounded-md border px-3 py-2">
            <SchemaViewer schema={bodySchema} />
          </div>
        </div>
      ) : null}

      {/* Responses */}
      <div className="mt-5">
        <h3 className="mb-2 text-sm font-semibold">Responses</h3>
        <div className="space-y-2">
          {Object.entries(op.responses).map(([code, response]) => (
            <ResponseRow key={code} code={code} response={response} />
          ))}
        </div>
      </div>

      {/* Code samples */}
      <div className="mt-5">
        <h3 className="mb-2 text-sm font-semibold">Code samples</h3>
        <CodeSamplesTabs samples={samples} />
      </div>

      {/* Try it */}
      <div className="mt-5">
        <Button variant="outline" size="sm" onClick={() => setTryOpen((v) => !v)}>
          <TerminalIcon className="size-4" />
          {tryOpen ? "Hide console" : "Try it"}
        </Button>
        {tryOpen ? (
          <div className="mt-3">
            <TryItConsole op={op} baseUrl={baseUrl} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

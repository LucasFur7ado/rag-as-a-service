"use client";

import { useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import { PlayIcon, Loader2Icon } from "lucide-react";
import type { Operation, ParameterObject } from "@/lib/openapi";
import {
  buildQuery,
  curlFor,
  exampleForSchema,
  fillPath,
  type RequestModel,
} from "@/lib/code-samples";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/docs/label";
import { CopyButton } from "./copy-button";
import { cn } from "@/lib/utils";

type AuthMode = "session" | "apikey";

interface ResponseState {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  timeMs: number;
  body: string;
  streaming?: boolean;
}

function jsonBodySchema(op: Operation) {
  return op.requestBody?.content?.["application/json"]?.schema;
}
function isMultipart(op: Operation) {
  return Boolean(op.requestBody?.content?.["multipart/form-data"]);
}
function isQueryStream(op: Operation, body: string): boolean {
  if (op.path !== "/v1/collections/{id}/query") return false;
  try {
    return JSON.parse(body).stream !== false;
  } catch {
    return true;
  }
}

/** Initial value for a parameter input, from its example. */
function paramInitial(p: ParameterObject): string {
  const ex = p.schema?.example;
  return ex === undefined || ex === null ? "" : String(ex);
}

/**
 * Executes a real request against the API. Auth is either the current Clerk
 * session or a pasted API key — the pasted key lives ONLY in this component's
 * state (never localStorage/sessionStorage/URL). The query endpoint streams
 * progressively.
 */
export function TryItConsole({ op, baseUrl }: { op: Operation; baseUrl: string }) {
  const { isSignedIn, getToken } = useAuth();

  const pathParamDefs = op.parameters.filter((p) => p.in === "path");
  const queryParamDefs = op.parameters.filter((p) => p.in === "query");
  const bodySchema = jsonBodySchema(op);
  const multipart = isMultipart(op);
  const acceptsApiKey = (op.security ?? []).some((r) => "ApiKeyAuth" in r);
  const acceptsSession = (op.security ?? []).some((r) => "SessionAuth" in r);

  const [authMode, setAuthMode] = useState<AuthMode>(
    acceptsSession && !acceptsApiKey ? "session" : "apikey",
  );
  const [apiKey, setApiKey] = useState("");
  const [pathValues, setPathValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(pathParamDefs.map((p) => [p.name, paramInitial(p)])),
  );
  const [queryValues, setQueryValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(queryParamDefs.map((p) => [p.name, paramInitial(p)])),
  );
  const [bodyText, setBodyText] = useState(() =>
    bodySchema ? JSON.stringify(exampleForSchema(bodySchema), null, 2) : "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<ResponseState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const url = useMemo(
    () => `${baseUrl}${fillPath(op, pathValues)}${buildQuery(op, queryValues)}`,
    [baseUrl, op, pathValues, queryValues],
  );

  // Equivalent curl for the CURRENT config. Session tokens are shown as a
  // placeholder (fetched only at send time); a pasted key is shown as configured.
  const equivalentCurl = useMemo(() => {
    const headers: Record<string, string> = {};
    if (authMode === "apikey") headers.Authorization = `Bearer ${apiKey || "rag_live_YOUR_KEY"}`;
    else headers.Authorization = "Bearer <clerk-session-jwt>";
    let bodyObject: unknown;
    if (!multipart && bodyText.trim()) {
      try {
        bodyObject = JSON.parse(bodyText);
        headers["Content-Type"] = "application/json";
      } catch {
        bodyObject = undefined;
      }
    }
    const model: RequestModel = { method: op.method, url, headers, bodyObject, multipart };
    return curlFor(model);
  }, [authMode, apiKey, bodyText, multipart, op.method, url]);

  async function resolveAuthHeader(): Promise<Record<string, string>> {
    if (authMode === "apikey") {
      if (!apiKey.trim()) throw new Error("Enter an API key to send this request.");
      return { Authorization: `Bearer ${apiKey.trim()}` };
    }
    const token = await getToken();
    if (!token) throw new Error("You are not signed in — sign in or use an API key.");
    return { Authorization: `Bearer ${token}` };
  }

  async function send() {
    setRunning(true);
    setError(null);
    setResponse(null);
    setStreamText("");
    const started = performance.now();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const headers = await resolveAuthHeader();
      let body: BodyInit | undefined;
      if (multipart) {
        if (!file) throw new Error("Choose a file to upload.");
        const form = new FormData();
        form.append("file", file);
        body = form;
      } else if (bodyText.trim()) {
        headers["Content-Type"] = "application/json";
        body = bodyText;
      }

      const res = await fetch(url, { method: op.method, headers, body, signal: controller.signal });
      const headerList = [...res.headers.entries()];

      if (isQueryStream(op, bodyText) && res.body && res.ok) {
        // Progressive SSE render.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let acc = "";
        let tail = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("");
            if (!data) continue;
            try {
              const evt = JSON.parse(data);
              if (evt.type === "delta") {
                acc += evt.text;
                setStreamText(acc);
              } else if (evt.type === "sources") {
                tail = `\n\n— sources & usage —\n${JSON.stringify({ sources: evt.sources, usage: evt.usage }, null, 2)}`;
              } else if (evt.type === "error") {
                tail = `\n\n[stream error] ${evt.message}`;
              }
            } catch {
              /* ignore keep-alives */
            }
          }
        }
        setResponse({
          status: res.status,
          statusText: res.statusText,
          headers: headerList,
          timeMs: Math.round(performance.now() - started),
          body: acc + tail,
          streaming: true,
        });
        setStreamText("");
      } else {
        const raw = await res.text();
        let pretty = raw;
        try {
          pretty = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          /* non-JSON body — leave as-is */
        }
        setResponse({
          status: res.status,
          statusText: res.statusText,
          headers: headerList,
          timeMs: Math.round(performance.now() - started),
          body: pretty,
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Request failed.");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const statusColor = (s: number) =>
    s < 300
      ? "text-chart-success"
      : s < 500
        ? "text-chart-rate-limited"
        : "text-chart-error";

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      {/* Auth */}
      <div className="space-y-2">
        <Label>Authentication</Label>
        <div className="flex flex-wrap gap-2">
          {acceptsSession ? (
            <Button
              type="button"
              size="sm"
              variant={authMode === "session" ? "default" : "outline"}
              onClick={() => setAuthMode("session")}
            >
              Session {isSignedIn ? "(signed in)" : "(signed out)"}
            </Button>
          ) : null}
          {acceptsApiKey ? (
            <Button
              type="button"
              size="sm"
              variant={authMode === "apikey" ? "default" : "outline"}
              onClick={() => setAuthMode("apikey")}
            >
              API key
            </Button>
          ) : null}
        </div>
        {authMode === "apikey" ? (
          <div>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="rag_live_…"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Kept in memory only — never stored in localStorage, the URL, or anywhere else.
            </p>
          </div>
        ) : null}
      </div>

      {/* Path params */}
      {pathParamDefs.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {pathParamDefs.map((p) => (
            <div key={p.name}>
              <Label>
                {p.name} <span className="text-muted-foreground">(path)</span>
              </Label>
              <Input
                value={pathValues[p.name] ?? ""}
                onChange={(e) => setPathValues((v) => ({ ...v, [p.name]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      ) : null}

      {/* Query params */}
      {queryParamDefs.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {queryParamDefs.map((p) => (
            <div key={p.name}>
              <Label>
                {p.name}{" "}
                <span className="text-muted-foreground">(query{p.required ? ", required" : ""})</span>
              </Label>
              <Input
                value={queryValues[p.name] ?? ""}
                onChange={(e) => setQueryValues((v) => ({ ...v, [p.name]: e.target.value }))}
                placeholder={p.description}
              />
            </div>
          ))}
        </div>
      ) : null}

      {/* Body */}
      {multipart ? (
        <div>
          <Label>File</Label>
          <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      ) : bodySchema ? (
        <div>
          <Label>Request body (JSON)</Label>
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            spellCheck={false}
            rows={Math.min(12, bodyText.split("\n").length + 1)}
            className="w-full rounded-md border bg-background p-2 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={send} disabled={running}>
          {running ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
          {running ? "Sending…" : "Send request"}
        </Button>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {op.method} {url}
        </span>
      </div>

      {/* Equivalent curl */}
      <div>
        <Label>Equivalent curl</Label>
        <div className="relative">
          <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
            {equivalentCurl}
          </pre>
          <CopyButton text={equivalentCurl} className="absolute right-1.5 top-1.5" />
        </div>
      </div>

      {/* Live stream */}
      {running && streamText ? (
        <div>
          <Label>Streaming…</Label>
          <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
            {streamText}
          </pre>
        </div>
      ) : null}

      {/* Error */}
      {error ? (
        <p className="rounded-md border border-chart-error/40 bg-chart-error/10 px-3 py-2 text-sm text-chart-error">
          {error}
        </p>
      ) : null}

      {/* Response */}
      {response ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span className={cn("font-mono font-semibold", statusColor(response.status))}>
              {response.status} {response.statusText}
            </span>
            <span className="text-muted-foreground">{response.timeMs} ms</span>
            {response.streaming ? <span className="text-muted-foreground">streamed</span> : null}
          </div>

          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
              Response headers ({response.headers.length})
            </summary>
            <div className="border-t px-3 py-2">
              <table className="w-full text-xs">
                <tbody>
                  {response.headers.map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-0.5 pr-3 font-mono text-muted-foreground">{k}</td>
                      <td className="py-0.5 font-mono break-all">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="relative">
            <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
              {response.body}
            </pre>
            <CopyButton text={response.body} className="absolute right-1.5 top-1.5" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

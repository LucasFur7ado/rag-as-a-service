"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  FileTextIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react";
import type { Citation, Collection, Document, QueryStreamEvent } from "@rag/shared";
import { RequireAuth } from "@/components/require-auth";
import { useApi } from "@/lib/use-api";
import { Answer } from "@/components/playground/answer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Query Playground (`/dashboard/collections/playground?id=…`).
 *
 * Ask a natural-language question against a collection; the answer streams in
 * token-by-token with inline, clickable citations, and a Sources panel lists
 * the chunks that grounded it. A static export can't prerender `[id]`, so the
 * id comes from the query string (same pattern as the collection view).
 */
export default function PlaygroundPage() {
  return (
    <RequireAuth>
      <Suspense
        fallback={
          <div className="mx-auto max-w-5xl px-4 py-12 text-sm text-muted-foreground">
            Loading…
          </div>
        }
      >
        <Playground />
      </Suspense>
    </RequireAuth>
  );
}

/** Phases of one query lifecycle. */
type Phase = "idle" | "streaming" | "done" | "error";

function Playground() {
  const collectionId = useSearchParams().get("id");
  const api = useApi();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Citation[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeMarker, setActiveMarker] = useState<number | null>(null);

  // Holds the in-flight request so it can be cancelled; ref so it doesn't
  // trigger re-renders and survives across the streaming callbacks.
  const abortRef = useRef<AbortController | null>(null);
  const sourceRefs = useRef(new Map<number, HTMLLIElement>());

  const readyCount = useMemo(
    () => (documents ?? []).filter((d) => d.status === "ready").length,
    [documents],
  );
  const canQuery = readyCount > 0;

  useEffect(() => {
    if (!collectionId) return;
    let cancelled = false;
    (async () => {
      try {
        const [col, docs] = await Promise.all([
          api.getCollection(collectionId),
          api.listDocuments(collectionId),
        ]);
        if (cancelled) return;
        setCollection(col);
        setDocuments(docs);
      } catch (err) {
        if (cancelled) return;
        setNotFound(true);
        toast.error(err instanceof Error ? err.message : "Failed to load collection");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, collectionId]);

  // Cancel any in-flight stream when leaving the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleCitationActivate = useCallback((marker: number) => {
    setActiveMarker(marker);
    sourceRefs.current
      .get(marker)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // The /raw endpoint requires a Bearer token, so a plain <a href> 401s; fetch
  // the file as a blob (authed) and open it in a new tab instead.
  const openSourceFile = useCallback(
    async (documentId: string) => {
      try {
        const blob = await api.downloadDocument(documentId);
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        // Give the new tab time to load before revoking the object URL.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not open file");
      }
    },
    [api],
  );

  async function handleSubmit() {
    const q = question.trim();
    if (!q || !collectionId || phase === "streaming") return;

    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("streaming");
    setAnswer("");
    setSources([]);
    setActiveMarker(null);

    try {
      await api.streamQuery(
        collectionId,
        { query: q },
        (event: QueryStreamEvent) => {
          switch (event.type) {
            case "delta":
              setAnswer((prev) => prev + event.text);
              break;
            case "sources":
              setSources(event.sources);
              if (event.usage.invalidMarkers.length > 0) {
                toast.warning(
                  `The model cited ${event.usage.invalidMarkers.length} source(s) that don't exist; they were dropped.`,
                );
              }
              break;
            case "done":
              setPhase("done");
              break;
            case "error":
              setPhase("error");
              toast.error(event.message);
              break;
          }
        },
        controller.signal,
      );
      // If the stream ended without an explicit done/error (e.g. aborted).
      setPhase((p) => (p === "streaming" ? "done" : p));
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase("idle");
        return;
      }
      setPhase("error");
      toast.error(err instanceof Error ? err.message : "Query failed");
    } finally {
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
  }

  if (!collectionId || notFound) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Collection not found.{" "}
            <Link href="/dashboard/collections/" className="underline">
              Back to collections
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const streaming = phase === "streaming";
  const showAnswer = answer.length > 0 || streaming;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-6">
        <Button
          render={
            <Link href={`/dashboard/collections/view/?id=${encodeURIComponent(collectionId)}`} />
          }
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2"
        >
          <ArrowLeftIcon data-icon="inline-start" />
          {collection?.name ?? "Collection"}
        </Button>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold">
          <SparklesIcon className="size-5 text-primary" />
          Playground
        </h1>
        <p className="text-sm text-muted-foreground">
          Ask a question grounded in this collection&apos;s documents.
        </p>
      </div>

      {/* Question input */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-start gap-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter inserts a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              rows={2}
              disabled={!canQuery}
              placeholder={
                canQuery
                  ? "Ask anything about these documents…"
                  : "Upload and ingest a document before querying."
              }
              className="min-h-10 flex-1 resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            />
            {streaming ? (
              <Button variant="outline" onClick={handleCancel} className="mt-0.5">
                <SquareIcon data-icon="inline-start" />
                Stop
              </Button>
            ) : (
              <Button
                onClick={() => void handleSubmit()}
                disabled={!canQuery || !question.trim()}
                className="mt-0.5"
              >
                <SendIcon data-icon="inline-start" />
                Ask
              </Button>
            )}
          </div>
          {documents !== null && !canQuery && (
            <p className="mt-2 text-xs text-muted-foreground">
              No ready documents in this collection yet.{" "}
              <Link
                href={`/dashboard/collections/view/?id=${encodeURIComponent(collectionId)}`}
                className="underline"
              >
                Upload one
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      {/* Answer + sources */}
      {showAnswer && (
        <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Answer</CardTitle>
            </CardHeader>
            <CardContent>
              {answer ? (
                <Answer
                  text={answer}
                  sources={sources}
                  onCitationActivate={handleCitationActivate}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Thinking…</p>
              )}
              {streaming && answer && (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground align-middle" />
              )}
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Sources</CardTitle>
              <CardDescription>
                {sources.length > 0
                  ? `${sources.length} chunk${sources.length === 1 ? "" : "s"} retrieved`
                  : streaming
                    ? "Resolving…"
                    : "—"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {streaming ? "Sources appear once the answer completes." : "No sources."}
                </p>
              ) : (
                <ul className="space-y-3">
                  {sources.map((source) => (
                    <li
                      key={source.marker}
                      ref={(el) => {
                        if (el) sourceRefs.current.set(source.marker, el);
                        else sourceRefs.current.delete(source.marker);
                      }}
                      className={`rounded-lg border p-2.5 transition-colors ${
                        activeMarker === source.marker
                          ? "border-primary bg-primary/5"
                          : "border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Badge variant="outline" className="shrink-0 tabular-nums">
                            {source.marker}
                          </Badge>
                          <span className="truncate text-xs font-medium" title={source.filename}>
                            {source.filename}
                          </span>
                        </span>
                        {!source.cited && (
                          <span
                            className="shrink-0 text-[0.65rem] text-muted-foreground"
                            title="Retrieved as context but not cited in the answer"
                          >
                            unused
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[0.65rem] text-muted-foreground">
                        {source.page != null ? `Page ${source.page} · ` : ""}
                        {(source.score * 100).toFixed(0)}% match
                      </p>
                      <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                        {source.snippet}
                      </p>
                      <Button
                        variant="link"
                        size="xs"
                        className="mt-1 -ml-1 h-auto"
                        onClick={() => void openSourceFile(source.documentId)}
                      >
                        <FileTextIcon data-icon="inline-start" />
                        Open file
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import type { UsageEvent } from "@rag/shared";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "./recent-queries";
import {
  formatBytes,
  formatCost,
  formatCount,
  formatLatency,
} from "@/lib/format";

/**
 * Full event detail (Feature 5, Part C §7). Opened from a recent-queries row;
 * shows every recorded field, grouped. Query text is shown only when the
 * server returned it (STORE_RAW_QUERY_TEXT enabled) — otherwise it was never
 * stored, and we say so.
 */
export function EventDetailSheet({
  event,
  collectionName,
  onClose,
}: {
  event: UsageEvent | null;
  collectionName: (id: string | null) => string;
  onClose: () => void;
}) {
  return (
    <Sheet open={event !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {event && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="capitalize">{event.eventType}</span> event
                <StatusBadge status={event.status} />
              </SheetTitle>
              <SheetDescription>
                {new Date(event.createdAt).toLocaleString()} ·{" "}
                <span className="font-mono text-[0.7rem]">{event.id}</span>
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 px-4 pb-6">
              <Section title="Overview">
                <Row label="Auth">
                  {event.authType === "apikey" ? "API key" : "Dashboard session"}
                </Row>
                {event.apiKeyId && (
                  <Row label="API key id">
                    <span className="font-mono text-[0.7rem]">{event.apiKeyId}</span>
                  </Row>
                )}
                {event.eventType === "query" && (
                  <Row label="Collection">{collectionName(event.collectionId)}</Row>
                )}
                {event.errorCode && (
                  <Row label="Error code">
                    <span className="font-mono text-chart-error">
                      {event.errorCode}
                    </span>
                  </Row>
                )}
              </Section>

              {event.eventType === "query" && (
                <>
                  <Separator />
                  <Section title="Retrieval">
                    <Row label="Chunks retrieved">
                      {event.chunksRetrieved ?? "—"}
                    </Row>
                    <Row label="Top score">
                      {event.topScore != null
                        ? `${(event.topScore * 100).toFixed(1)}%`
                        : "—"}
                    </Row>
                    <Row label="Query length">
                      {event.queryLength != null
                        ? `${event.queryLength} chars`
                        : "—"}
                    </Row>
                  </Section>

                  <Separator />
                  <Section title="Latency">
                    <Row label="Total">{formatLatency(event.latencyTotalMs)}</Row>
                    <Row label="Embedding">{formatLatency(event.latencyEmbedMs)}</Row>
                    <Row label="Retrieval">{formatLatency(event.latencyRetrievalMs)}</Row>
                    <Row label="Generation">{formatLatency(event.latencyGenerationMs)}</Row>
                  </Section>

                  <Separator />
                  <Section title="Tokens & cost">
                    <Row label="Prompt tokens">
                      {event.tokensPrompt != null ? formatCount(event.tokensPrompt) : "—"}
                    </Row>
                    <Row label="Completion tokens">
                      {event.tokensCompletion != null
                        ? formatCount(event.tokensCompletion)
                        : "—"}
                    </Row>
                    <Row label="Estimated cost">{formatCost(event.estimatedCost)}</Row>
                  </Section>
                </>
              )}

              {event.eventType === "ingestion" && (
                <>
                  <Separator />
                  <Section title="Ingestion">
                    <Row label="Document id">
                      <span className="font-mono text-[0.7rem]">
                        {event.documentId ?? "—"}
                      </span>
                    </Row>
                    <Row label="Duration">{formatLatency(event.latencyTotalMs)}</Row>
                    <Row label="Chunks produced">{event.chunkCount ?? "—"}</Row>
                    <Row label="Bytes processed">
                      {formatBytes(event.bytesProcessed)}
                    </Row>
                  </Section>
                </>
              )}

              {event.eventType === "query" && (
                <>
                  <Separator />
                  <Section title="Query text">
                    {event.queryText ? (
                      <p className="rounded-md bg-muted/50 p-2 text-xs">
                        {event.queryText}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Not stored — only a hash and length are kept by default
                        (privacy). Enable{" "}
                        <code className="font-mono text-[0.7rem]">
                          STORE_RAW_QUERY_TEXT
                        </code>{" "}
                        to retain plaintext.
                      </p>
                    )}
                  </Section>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </h3>
      <dl className="grid gap-1">{children}</dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

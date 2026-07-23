"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  DownloadIcon,
  FileTextIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import type { Collection, Document, DocumentStatus } from "@rag/shared";
import { RequireAuth } from "@/components/require-auth";
import { useApi } from "@/lib/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Collection detail as a query-param route (`/dashboard/collections/view?id=…`).
 * A static export cannot prerender dynamic `[id]` segments (IDs are unknown at
 * build time), so the id is read client-side from the search params instead.
 */

// Keep in sync with MAX_UPLOAD_BYTES in apps/api/src/routes/collections.ts.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ACCEPT = ".pdf,.txt,.md,application/pdf,text/plain,text/markdown";

const STATUS_BADGE: Record<
  DocumentStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  uploaded: "secondary",
  processing: "outline",
  ready: "default",
  error: "destructive",
};

/** How often to poll /status while any document is still being ingested. */
const STATUS_POLL_MS = 3000;

/** Ingestion still in flight — keep polling until it settles. */
function isUnsettled(status: DocumentStatus): boolean {
  return status === "uploaded" || status === "processing";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CollectionViewPage() {
  return (
    <RequireAuth>
      {/* useSearchParams requires a Suspense boundary in static builds. */}
      <Suspense
        fallback={
          <div className="mx-auto max-w-5xl px-4 py-12 text-sm text-muted-foreground">
            Loading…
          </div>
        }
      >
        <CollectionView />
      </Suspense>
    </RequireAuth>
  );
}

function CollectionView() {
  const collectionId = useSearchParams().get("id");
  const api = useApi();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<Document | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!collectionId) return;
    try {
      const [col, docs] = await Promise.all([
        api.getCollection(collectionId),
        api.listDocuments(collectionId),
      ]);
      setCollection(col);
      setDocuments(docs);
    } catch (err) {
      setNotFound(true);
      toast.error(err instanceof Error ? err.message : "Failed to load collection");
    }
  }, [api, collectionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll ingestion status while any document is unsettled; when a status
  // changes the id list changes, which re-arms (or stops) the interval.
  const unsettledIds = (documents ?? [])
    .filter((d) => isUnsettled(d.status))
    .map((d) => d.id)
    .join(",");

  useEffect(() => {
    if (!unsettledIds) return;
    const ids = unsettledIds.split(",");

    const tick = async () => {
      const results = await Promise.allSettled(
        ids.map(async (id) => ({ id, status: await api.getDocumentStatus(id) })),
      );
      const byId = new Map(
        results
          .filter((r) => r.status === "fulfilled")
          .map((r) => [r.value.id, r.value.status]),
      );
      if (byId.size === 0) return;
      setDocuments(
        (prev) =>
          prev?.map((doc) => {
            const update = byId.get(doc.id);
            if (!update || update.status === doc.status) return doc;
            return {
              ...doc,
              status: update.status,
              chunkCount: update.chunkCount,
              error: update.error,
              updatedAt: update.updatedAt,
            };
          }) ?? null,
      );
    };

    const interval = setInterval(() => void tick(), STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [api, unsettledIds]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file || !collectionId) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(
        `“${file.name}” is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}`,
      );
      return;
    }

    setUploading(true);
    try {
      const doc = await api.uploadDocument(collectionId, file);
      setDocuments((prev) => [doc, ...(prev ?? [])]);
      toast.success(`“${doc.filename}” uploaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: Document) {
    try {
      const blob = await api.downloadDocument(doc.id);
      // The API requires a Bearer header, so a plain <a href> can't be used;
      // fetch the blob and hand it to the browser as an object URL instead.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  }

  async function handleReprocess(doc: Document) {
    try {
      await api.reingestDocument(doc.id);
      // Flip to processing right away so status polling kicks in.
      setDocuments(
        (prev) =>
          prev?.map((d) =>
            d.id === doc.id
              ? { ...d, status: "processing" as const, error: undefined }
              : d,
          ) ?? null,
      );
      toast.success(`Reprocessing “${doc.filename}”`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reprocess");
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api.deleteDocument(toDelete.id);
      setDocuments((prev) => prev?.filter((d) => d.id !== toDelete.id) ?? null);
      toast.success(`“${toDelete.filename}” deleted`);
      setToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete document");
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-6">
        <Button
          render={<Link href="/dashboard/collections/" />}
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2"
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Collections
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold">
              {collection?.name ?? "Loading…"}
            </h1>
            {collection?.description && (
              <p className="text-sm text-muted-foreground">
                {collection.description}
              </p>
            )}
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <UploadIcon data-icon="inline-start" />
              {uploading ? "Uploading…" : "Upload document"}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF, plain text, or Markdown — up to {formatBytes(MAX_UPLOAD_BYTES)}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>
            Files uploaded to this collection. New uploads are parsed, chunked
            and indexed automatically — statuses update live below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documents === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : documents.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No documents yet. Upload a PDF, text, or Markdown file.
            </p>
          ) : (
            <ul className="divide-y">
              {documents.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 py-3">
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{doc.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(doc.sizeBytes)} ·{" "}
                      {new Date(doc.createdAt).toLocaleString()}
                      {doc.status === "ready" && doc.chunkCount != null && (
                        <> · {doc.chunkCount} chunks</>
                      )}
                    </p>
                    {doc.status === "error" && doc.error && (
                      <p className="truncate text-xs text-destructive" title={doc.error}>
                        {doc.error}
                      </p>
                    )}
                  </div>
                  <Badge variant={STATUS_BADGE[doc.status]}>
                    {doc.status === "processing" && (
                      <RefreshCwIcon className="size-3 animate-spin" />
                    )}
                    {doc.status}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Reprocess ${doc.filename}`}
                    title="Reprocess (re-run ingestion)"
                    disabled={isUnsettled(doc.status)}
                    onClick={() => handleReprocess(doc)}
                  >
                    <RefreshCwIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Download ${doc.filename}`}
                    onClick={() => handleDownload(doc)}
                  >
                    <DownloadIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${doc.filename}`}
                    onClick={() => setToDelete(doc)}
                  >
                    <Trash2Icon className="text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document?</DialogTitle>
            <DialogDescription>
              “{toDelete?.filename}” will be permanently deleted. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

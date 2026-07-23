"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ApiKey } from "@rag/shared";
import { RequireAuth } from "@/components/require-auth";
import { useApi } from "@/lib/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * API keys management (`/dashboard/api-keys`). Session-only surface: the API
 * itself refuses to manage keys with an API key. The full plaintext key is
 * shown exactly once (on creation) and never persisted in client state.
 */
export default function ApiKeysPage() {
  return (
    <RequireAuth>
      <ApiKeys />
    </RequireAuth>
  );
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

function formatDate(ms?: number): string {
  return ms ? new Date(ms).toLocaleDateString() : "—";
}

function ApiKeys() {
  const api = useApi();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [toRevoke, setToRevoke] = useState<ApiKey | null>(null);
  const [busy, setBusy] = useState(false);
  // The one-time plaintext key + its metadata, held only while its dialog is open.
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);
  // A real collection id for the curl snippet, when the tenant has one.
  const [sampleCollectionId, setSampleCollectionId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listApiKeys();
      setKeys(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load API keys");
      setKeys([]);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Best-effort: grab a collection id to make the curl example runnable.
    (async () => {
      try {
        const cols = await api.listCollections();
        if (cols.length > 0) setSampleCollectionId(cols[0].id);
      } catch {
        // Non-fatal — the snippet falls back to a placeholder.
      }
    })();
  }, [api]);

  async function handleRevoke() {
    if (!toRevoke) return;
    setBusy(true);
    try {
      await api.revokeApiKey(toRevoke.id);
      setKeys((prev) =>
        prev?.map((k) =>
          k.id === toRevoke.id ? { ...k, revokedAt: Date.now() } : k,
        ) ?? null,
      );
      toast.success(`Revoked “${toRevoke.name}”`);
      setToRevoke(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setBusy(false);
    }
  }

  const activeKeys = (keys ?? []).filter((k) => !k.revokedAt);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold">
            <KeyRoundIcon className="size-5 text-muted-foreground" />
            API keys
          </h1>
          <p className="text-sm text-muted-foreground">
            Call the API programmatically with{" "}
            <code className="font-mono text-xs">Authorization: Bearer rag_live_…</code>.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          Create key
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
          <CardDescription>
            Keys are shown by prefix only. Each is rate-limited per minute and
            has full access to your tenant&apos;s collections and documents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {keys === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : keys.length === 0 ? (
            <EmptyState onCreate={() => setCreateOpen(true)} />
          ) : (
            <ul className="divide-y">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center gap-3 py-3">
                  <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{k.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {k.keyPrefix}…{k.last4}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {k.rateLimitPerMinute}/min · created {formatDate(k.createdAt)} ·
                      last used {formatDate(k.lastUsedAt)}
                    </p>
                  </div>
                  {k.revokedAt ? (
                    <Badge variant="destructive">revoked</Badge>
                  ) : (
                    <Badge variant="secondary">active</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Revoke ${k.name}`}
                    disabled={!!k.revokedAt}
                    onClick={() => setToRevoke(k)}
                  >
                    <Trash2Icon className="text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <UseTheApiSnippet
        apiUrl={API_URL}
        collectionId={sampleCollectionId}
        hasActiveKey={activeKeys.length > 0}
      />

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(created) => {
          setKeys((prev) => [created.apiKey, ...(prev ?? [])]);
          setNewKey({ key: created.key, name: created.apiKey.name });
        }}
      />

      <ShowKeyOnceDialog value={newKey} onClose={() => setNewKey(null)} />

      {/* Revoke confirmation */}
      <Dialog open={toRevoke !== null} onOpenChange={(open) => !open && setToRevoke(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API key?</DialogTitle>
            <DialogDescription>
              “{toRevoke?.name}” will stop working immediately. Any integration
              using it will start receiving 401 errors. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={handleRevoke} disabled={busy}>
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <KeyRoundIcon className="size-8 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">No API keys yet</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          API keys let you call the query and document endpoints from your own
          code or scripts — outside the dashboard — with a rate limit per key.
        </p>
      </div>
      <Button onClick={onCreate} size="sm">
        <PlusIcon data-icon="inline-start" />
        Create your first key
      </Button>
    </div>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: import("@rag/shared").ApiKeyCreateResponse) => void;
}) {
  const api = useApi();
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset fields whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setName("");
      setLimit("");
    }
  }, [open]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the key a name");
      return;
    }
    const rateLimitPerMinute = limit.trim() ? Number(limit) : undefined;
    if (rateLimitPerMinute !== undefined && (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1)) {
      toast.error("Rate limit must be a positive whole number");
      return;
    }

    setBusy(true);
    try {
      const created = await api.createApiKey({ name: trimmed, rateLimitPerMinute });
      onCreated(created);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            Give it a recognizable name. You can optionally set a per-minute
            rate limit (defaults to the server&apos;s standard limit).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <label htmlFor="key-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production backend"
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="key-limit" className="text-sm font-medium">
              Rate limit{" "}
              <span className="font-normal text-muted-foreground">
                (requests/minute, optional)
              </span>
            </label>
            <Input
              id="key-limit"
              type="number"
              min={1}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="Default"
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={busy}>
            Create key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShowKeyOnceDialog({
  value,
  onClose,
}: {
  value: { key: string; name: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed — select and copy the key manually");
    }
  }

  return (
    <Dialog
      open={value !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Copy your API key</DialogTitle>
          <DialogDescription>
            This is the only time the full key for “{value?.name}” is shown.
            Store it somewhere safe — you won&apos;t be able to see it again.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs" title={value?.key}>
            {value?.key}
          </code>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <CopyIcon data-icon="inline-start" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            Treat this like a password. Anyone with it can query and read this
            tenant&apos;s data until the key is revoked.
          </span>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            I&apos;ve saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ready-to-copy curl example hitting the query endpoint with an API key. */
function UseTheApiSnippet({
  apiUrl,
  collectionId,
  hasActiveKey,
}: {
  apiUrl: string;
  collectionId: string | null;
  hasActiveKey: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const id = collectionId ?? "<collection-id>";
  const snippet = `curl -X POST "${apiUrl}/v1/collections/${id}/query" \\
  -H "Authorization: Bearer rag_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "What is this collection about?", "stream": false}'`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">Use the API</CardTitle>
        <CardDescription>
          Swap in a key you created above.{" "}
          {hasActiveKey
            ? "A 429 response means you hit the rate limit — check the Retry-After header."
            : "Create a key to get started."}
          {!collectionId && " Replace <collection-id> with one of your collection ids."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 pr-12 text-xs leading-relaxed">
            <code>{snippet}</code>
          </pre>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-2 right-2"
            aria-label="Copy curl command"
            onClick={copy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

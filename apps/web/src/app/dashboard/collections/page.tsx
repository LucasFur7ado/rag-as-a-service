"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FolderIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { Collection } from "@rag/shared";
import { RequireAuth } from "@/components/require-auth";
import { useApi } from "@/lib/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardAction,
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
  DialogTrigger,
} from "@/components/ui/dialog";

// Client-rendered and client-gated (static export): the HTML shell is public,
// data only loads after Clerk resolves a session and the API accepts its JWT.
export default function CollectionsPage() {
  return (
    <RequireAuth>
      <CollectionsContent />
    </RequireAuth>
  );
}

function CollectionsContent() {
  const api = useApi();
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  /** Collection awaiting delete confirmation (drives the confirm dialog). */
  const [toDelete, setToDelete] = useState<Collection | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCollections(await api.listCollections());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load collections");
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await api.createCollection({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      // Optimistic prepend; server list is refreshed on next load.
      setCollections((prev) => [created, ...(prev ?? [])]);
      setCreateOpen(false);
      setName("");
      setDescription("");
      toast.success(`Collection “${created.name}” created`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create collection");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api.deleteCollection(toDelete.id);
      setCollections((prev) => prev?.filter((c) => c.id !== toDelete.id) ?? null);
      toast.success(`Collection “${toDelete.name}” deleted`);
      setToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete collection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Collections</h1>
          <p className="text-sm text-muted-foreground">
            Group documents into collections to index and query them together.
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button />}>
            <PlusIcon data-icon="inline-start" />
            New collection
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New collection</DialogTitle>
              <DialogDescription>
                Name your collection; the description is optional.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="grid gap-3">
              <Input
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
              <Input
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <DialogFooter className="mt-1">
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button type="submit" disabled={busy || !name.trim()}>
                  Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {collections === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : collections.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No collections yet. Create your first one to start uploading
            documents.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => (
            <Card key={collection.id} size="sm">
              <CardHeader>
                <CardTitle>
                  <Link
                    href={`/dashboard/collections/view/?id=${collection.id}`}
                    className="flex items-center gap-2 hover:underline"
                  >
                    <FolderIcon className="size-4 text-muted-foreground" />
                    {collection.name}
                  </Link>
                </CardTitle>
                {collection.description && (
                  <CardDescription>{collection.description}</CardDescription>
                )}
                <CardAction>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${collection.name}`}
                    onClick={() => setToDelete(collection)}
                  >
                    <Trash2Icon className="text-destructive" />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Created {new Date(collection.createdAt).toLocaleDateString()}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete collection?</DialogTitle>
            <DialogDescription>
              “{toDelete?.name}” and all of its documents will be permanently
              deleted. This cannot be undone.
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

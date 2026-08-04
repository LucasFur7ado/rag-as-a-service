import "server-only";

import { del, get, list, put } from "@vercel/blob";

/**
 * Raw-file storage on Vercel Blob (replaces the R2 bucket).
 *
 * The store MUST be created with **private** access: these are tenants'
 * uploaded documents, and a public store would make every one of them readable
 * by anyone holding the URL. With a private store the blob URL is useless
 * without the store token, and files reach users only through
 * `GET /api/v1/documents/:id/raw`, which authenticates and tenant-scopes first.
 *
 * Pathnames mirror the old R2 keys exactly
 * (`tenants/{tenantId}/collections/{collectionId}/documents/{documentId}/{filename}`)
 * so the prefix sweeps below still map one directory per document / collection.
 */

const ACCESS = "private" as const;

/** Blob pathname for a document's raw file. */
export function documentBlobPath(
  tenantId: string,
  collectionId: string,
  documentId: string,
  filename: string,
): string {
  return `tenants/${tenantId}/collections/${collectionId}/documents/${documentId}/${filename}`;
}

/** Prefix covering every object a collection owns. */
export function collectionPrefix(tenantId: string, collectionId: string): string {
  return `tenants/${tenantId}/collections/${collectionId}/`;
}

/**
 * Directory-style prefix of the folder a document owns, derived from its
 * blob path.
 */
export function documentPrefix(blobPath: string): string {
  return blobPath.slice(0, blobPath.lastIndexOf("/") + 1);
}

/** Store an uploaded file. Overwrite is allowed so a re-upload is idempotent. */
export async function putDocument(
  pathname: string,
  body: Blob | ArrayBuffer | ReadableStream | string,
  contentType: string,
): Promise<{ pathname: string }> {
  const result = await put(pathname, body, {
    access: ACCESS,
    contentType,
    // Pathnames are already unique (they embed the document uuid); a random
    // suffix would only make the object unaddressable from its stored path.
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return { pathname: result.pathname };
}

/** Fetched blob contents; null when the object no longer exists. */
export interface FetchedBlob {
  stream: ReadableStream;
  size: number | null;
  etag: string | null;
}

/**
 * Read an object back. `useCache: false` because the only reader is the
 * ingestion pipeline (which runs seconds after the write) and the raw-download
 * route — both want the object as stored, not a possibly-stale CDN copy.
 */
export async function getDocument(pathname: string): Promise<FetchedBlob | null> {
  const result = await get(pathname, { access: ACCESS, useCache: false });
  // `null` means no such object. A 304 can only arrive in response to an
  // `ifNoneMatch` we never send, so it is treated as "nothing to read" too —
  // narrowing on statusCode is also what proves `stream` is non-null.
  if (!result || result.statusCode !== 200) return null;
  return {
    stream: result.stream,
    size: result.blob.size,
    etag: result.blob.etag,
  };
}

/** Read an object fully into memory. Used by text extraction. */
export async function getDocumentBytes(
  pathname: string,
): Promise<ArrayBuffer | null> {
  const blob = await getDocument(pathname);
  if (!blob) return null;
  return await new Response(blob.stream).arrayBuffer();
}

/**
 * Delete every object under a prefix. `list` pages at 1000 entries, and `del`
 * accepts a batch of pathnames.
 */
export async function deleteByPrefix(prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    if (page.blobs.length > 0) {
      await del(page.blobs.map((b) => b.pathname));
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

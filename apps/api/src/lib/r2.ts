/** R2 helpers shared by the routes and the ingestion workflow. */

/**
 * Directory-style prefix of the R2 folder a document owns
 * (`tenants/.../documents/{documentId}/`), derived from its `r2_key`. The
 * folder holds the raw file plus any ingestion intermediates.
 */
export function documentPrefix(r2Key: string): string {
  return r2Key.slice(0, r2Key.lastIndexOf("/") + 1);
}

/** Key of an ingestion intermediate stored next to the raw file. */
export function ingestArtifactKey(r2Key: string, name: string): string {
  return `${documentPrefix(r2Key)}.ingest/${name}`;
}

/** Delete every object under a prefix (paginated; R2 lists 1000 per page). */
export async function deleteByPrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map((o) => o.key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

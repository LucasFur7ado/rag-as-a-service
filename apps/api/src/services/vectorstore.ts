/**
 * Vector store seam.
 *
 * A Pinecone implementation will land here later; the interface keeps the
 * provider swappable. The Pinecone SDK is a dependency but is NOT called yet.
 */

export interface VectorRecord {
  id: string;
  values: number[];
  metadata?: Record<string, string | number | boolean>;
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface VectorQuery {
  vector: number[];
  topK: number;
  /** Metadata filter, provider-specific shape kept loose for now. */
  filter?: Record<string, unknown>;
}

export interface VectorStore {
  /** Insert or update records within a namespace (e.g. a collection id). */
  upsert(namespace: string, records: VectorRecord[]): Promise<void>;
  /** Nearest-neighbour search within a namespace. */
  query(namespace: string, query: VectorQuery): Promise<VectorMatch[]>;
  /** Delete records by id within a namespace. */
  deleteMany(namespace: string, ids: string[]): Promise<void>;
}

/**
 * Placeholder implementation. Swap for a Pinecone-backed store
 * (`@pinecone-database/pinecone`) when implementing retrieval.
 */
export class NotImplementedVectorStore implements VectorStore {
  // TODO: implement with the Pinecone SDK using PINECONE_API_KEY / PINECONE_INDEX.
  upsert(_namespace: string, _records: VectorRecord[]): Promise<void> {
    throw new Error("VectorStore.upsert is not implemented");
  }

  query(_namespace: string, _query: VectorQuery): Promise<VectorMatch[]> {
    throw new Error("VectorStore.query is not implemented");
  }

  deleteMany(_namespace: string, _ids: string[]): Promise<void> {
    throw new Error("VectorStore.deleteMany is not implemented");
  }
}

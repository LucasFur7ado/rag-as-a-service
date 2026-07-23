import type {
  AuthContext,
  Collection,
  CreateCollectionRequest,
  Document,
  DocumentStatusResponse,
  ListCollectionsResponse,
  ListDocumentsResponse,
  ReingestDocumentResponse,
  UploadDocumentResponse,
} from "@rag/shared";

/**
 * Typed client for the RAG API worker (apps/api).
 *
 * Reads the base URL from NEXT_PUBLIC_API_URL and attaches the caller's Clerk
 * session token as a `Bearer` header. Pass a token getter — in this static
 * export that is always the client-side `useAuth().getToken` from
 * `@clerk/react`; there is no server runtime to fetch from.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** Returns the current Clerk session JWT, or null when signed out. */
export type TokenGetter = () => Promise<string | null>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApiClient(getToken: TokenGetter, baseUrl: string = API_URL) {
  /** Raw authenticated fetch; throws ApiError (with the server's message) on non-2xx. */
  async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      let message = `API request failed: ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // Non-JSON error body — keep the generic message.
      }
      throw new ApiError(res.status, message);
    }
    return res;
  }

  /** JSON request/response helper. */
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const res = await authedFetch(path, { ...init, headers });
    return (await res.json()) as T;
  }

  return {
    /** GET /me → the authenticated principal. */
    me: () => request<AuthContext>("/me"),

    // --- Collections -------------------------------------------------------
    listCollections: async () =>
      (await request<ListCollectionsResponse>("/v1/collections")).collections,

    createCollection: async (body: CreateCollectionRequest) =>
      (
        await request<{ collection: Collection }>("/v1/collections", {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).collection,

    getCollection: async (id: string) =>
      (
        await request<{ collection: Collection }>(
          `/v1/collections/${encodeURIComponent(id)}`,
        )
      ).collection,

    deleteCollection: async (id: string) => {
      await authedFetch(`/v1/collections/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },

    // --- Documents ---------------------------------------------------------
    listDocuments: async (collectionId: string) =>
      (
        await request<ListDocumentsResponse>(
          `/v1/collections/${encodeURIComponent(collectionId)}/documents`,
        )
      ).documents,

    /**
     * Multipart upload. The body is a FormData — do NOT set Content-Type
     * manually; the browser adds the correct multipart boundary itself.
     */
    uploadDocument: async (collectionId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await authedFetch(
        `/v1/collections/${encodeURIComponent(collectionId)}/documents`,
        { method: "POST", body: form },
      );
      return ((await res.json()) as UploadDocumentResponse).document;
    },

    getDocument: async (id: string) =>
      (
        await request<{ document: Document }>(
          `/v1/documents/${encodeURIComponent(id)}`,
        )
      ).document,

    /** Downloads the original file. Returns a Blob for client-side save/open. */
    downloadDocument: async (id: string) => {
      const res = await authedFetch(
        `/v1/documents/${encodeURIComponent(id)}/raw`,
      );
      return await res.blob();
    },

    /** Lightweight ingestion status for polling while a document processes. */
    getDocumentStatus: async (id: string) =>
      request<DocumentStatusResponse>(
        `/v1/documents/${encodeURIComponent(id)}/status`,
      ),

    /** Re-runs the ingestion pipeline (safe: vector ids are deterministic). */
    reingestDocument: async (id: string) =>
      (
        await request<ReingestDocumentResponse>(
          `/v1/documents/${encodeURIComponent(id)}/reingest`,
          { method: "POST" },
        )
      ).document,

    deleteDocument: async (id: string) => {
      await authedFetch(`/v1/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

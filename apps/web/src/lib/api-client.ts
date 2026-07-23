import type {
  ApiKeyCreateResponse,
  AuthContext,
  Collection,
  CreateApiKeyRequest,
  CreateCollectionRequest,
  Document,
  DocumentStatusResponse,
  ListApiKeysResponse,
  ListCollectionsResponse,
  ListDocumentsResponse,
  QueryRequest,
  QueryResponse,
  QueryStreamEvent,
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
    /** Seconds to wait before retrying — set on 429 responses. */
    public readonly retryAfter?: number,
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
      let retryAfter: number | undefined;
      try {
        const body = (await res.json()) as { error?: string; retryAfter?: number };
        if (body.error) message = body.error;
        if (typeof body.retryAfter === "number") retryAfter = body.retryAfter;
      } catch {
        // Non-JSON error body — keep the generic message.
      }
      if (res.status === 429) {
        // Prefer the header if the body didn't carry it.
        retryAfter ??= Number(res.headers.get("Retry-After")) || undefined;
        message =
          retryAfter != null
            ? `Rate limit exceeded. Try again in ${retryAfter}s.`
            : "Rate limit exceeded. Try again shortly.";
      }
      throw new ApiError(res.status, message, retryAfter);
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

  /**
   * Streaming RAG query. Opens the SSE stream, invokes `onEvent` for each
   * parsed {@link QueryStreamEvent} (text `delta`s, then a `sources` event,
   * then `done`), and resolves when the stream ends. Pass an AbortSignal to
   * cancel an in-flight query; abort resolves quietly rather than throwing.
   *
   * Errors surface two ways: an HTTP error before the stream opens throws
   * ApiError; a failure mid-generation arrives as an in-band `error` event.
   */
  async function streamQuery(
    collectionId: string,
    body: QueryRequest,
    onEvent: (event: QueryStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await authedFetch(
      `/v1/collections/${encodeURIComponent(collectionId)}/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal,
      },
    );
    if (!res.body) throw new ApiError(500, "No response stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line; each may span >1 `data:`.
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const data = rawEvent
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("");
          if (!data) continue;
          try {
            onEvent(JSON.parse(data) as QueryStreamEvent);
          } catch {
            // Ignore unparseable frames (keep-alives / comments).
          }
        }
      }
    } catch (err) {
      // A user-initiated abort is expected control flow, not an error.
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        return;
      }
      throw err;
    } finally {
      reader.releaseLock();
    }
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

    // --- API keys ----------------------------------------------------------
    /** List the tenant's API keys (never includes key material). */
    listApiKeys: async () =>
      (await request<ListApiKeysResponse>("/v1/api-keys")).apiKeys,

    /**
     * Create an API key. The response is the ONLY time the plaintext key is
     * returned — show it once, then discard it.
     */
    createApiKey: (body: CreateApiKeyRequest) =>
      request<ApiKeyCreateResponse>("/v1/api-keys", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    /** Revoke (soft delete) an API key. Takes effect immediately. */
    revokeApiKey: async (id: string) => {
      await authedFetch(`/v1/api-keys/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },

    // --- Query -------------------------------------------------------------
    /** Streamed RAG query. See `streamQuery` above. */
    streamQuery,

    /**
     * Non-streaming RAG query (`stream: false`) → the full JSON answer at
     * once. Useful for tests/eval; the Playground uses `streamQuery`.
     */
    query: (collectionId: string, body: QueryRequest) =>
      request<QueryResponse>(
        `/v1/collections/${encodeURIComponent(collectionId)}/query`,
        { method: "POST", body: JSON.stringify({ ...body, stream: false }) },
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

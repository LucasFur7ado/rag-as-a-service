import type { AuthContext } from "@rag/shared";

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
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      throw new ApiError(res.status, `API request failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  return {
    /** Example call: GET /me → the authenticated principal. */
    me: () => request<AuthContext>("/me"),

    // TODO: add feature calls (collections, documents, query, apikeys) here as
    // the corresponding API routes are implemented.
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

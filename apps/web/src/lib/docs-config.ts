/**
 * Docs configuration (Feature 6). Every URL the docs/examples show comes from
 * here (env-driven) — no hardcoded hosts inside components.
 */

/**
 * Base URL of the RAG API used in docs examples and the "Try it" console.
 * Shares NEXT_PUBLIC_API_URL with the rest of the app (see lib/api-client.ts).
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** Public source repository, linked from the docs footer/overview. */
export const REPO_URL =
  process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/your-org/rag-as-a-service";

/** Live spec URL (also embedded at build; the reference falls back to this). */
export const OPENAPI_JSON_URL = `${API_BASE_URL}/v1/openapi.json`;
export const OPENAPI_YAML_URL = `${API_BASE_URL}/v1/openapi.yaml`;

/** Placeholder shown wherever a real API key would go in examples. */
export const API_KEY_PLACEHOLDER = "rag_live_YOUR_KEY";

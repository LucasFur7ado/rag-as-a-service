import "server-only";

import type { ApiKey } from "@rag/shared";
import {
  API_KEY_DISPLAY_CHARS,
  API_KEY_PREFIX,
  API_KEY_RANDOM_BYTES,
} from "../config";
import type { ApiKeyRow } from "../db/schema";

/**
 * API key primitives: generation and hashing. No plaintext key is ever
 * persisted — only its SHA-256 hash. Lookup on the auth path is by hash
 * (constant work: one indexed read), never by iterating and comparing stored
 * keys.
 *
 * // TODO: scopes — all keys are currently full-access for their tenant. A
 * // future `scopes` column + check would gate individual operations.
 */

/** A freshly generated key: the plaintext (shown once) plus its stored parts. */
export interface GeneratedApiKey {
  /** Full plaintext key, e.g. "rag_live_…". Returned to the user exactly once. */
  plaintext: string;
  /** SHA-256 hex of the plaintext — what we store and look up by. */
  keyHash: string;
  /** Display prefix, e.g. "rag_live_a1b2". */
  keyPrefix: string;
  /** Last 4 chars of the plaintext. */
  last4: string;
}

/**
 * Generate a new API key using the Web Crypto CSPRNG (never Math.random).
 * The random component is base64url-encoded (URL/header-safe, no padding).
 */
export async function generateApiKey(): Promise<GeneratedApiKey> {
  const bytes = new Uint8Array(API_KEY_RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  const random = base64UrlEncode(bytes);
  const plaintext = `${API_KEY_PREFIX}${random}`;

  return {
    plaintext,
    keyHash: await sha256Hex(plaintext),
    keyPrefix: `${API_KEY_PREFIX}${random.slice(0, API_KEY_DISPLAY_CHARS)}`,
    last4: plaintext.slice(-4),
  };
}

/** SHA-256 of a string as lowercase hex, via the WebCrypto SubtleCrypto API. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A string that could be one of our API keys (cheap pre-check before hashing). */
export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

/** Serialize a row to the public {@link ApiKey} shape (no key material). */
export function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    last4: row.last4,
    rateLimitPerMinute: row.rateLimitPerMinute,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? undefined,
    revokedAt: row.revokedAt ?? undefined,
  };
}

/** base64url (RFC 4648 §5) without padding. */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

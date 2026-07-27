/** API key Zod schemas — source of truth for the API and web app. */
import { z } from "zod";
import { epochMillis } from "./common";

/**
 * An API key as exposed to the dashboard. NEVER contains key material: the
 * plaintext key is shown exactly once at creation (see ApiKeyCreateResponse)
 * and only a display prefix + last-4 are retained afterwards.
 */
export const ApiKeySchema = z
  .object({
    id: z.string().meta({ example: "key_1a2b3c4d" }),
    name: z.string().meta({ example: "Production server" }),
    keyPrefix: z.string().meta({ example: "rag_live_a1b2", description: "Leading display portion; not usable to authenticate." }),
    last4: z.string().meta({ example: "9f3c" }),
    rateLimitPerMinute: z.number().int().meta({ example: 60 }),
    createdAt: epochMillis(),
    lastUsedAt: epochMillis()
      .optional()
      .meta({ description: "Last successful auth with this key; null/absent if never used." }),
    revokedAt: epochMillis()
      .optional()
      .meta({ description: "When the key was revoked; null/absent while active." }),
  })
  .meta({ id: "ApiKey", description: "An API key (never includes key material)." });

/** Body for POST /v1/api-keys. */
export const CreateApiKeyRequestSchema = z
  .object({
    name: z.string().min(1).meta({ example: "Production server" }),
    rateLimitPerMinute: z
      .number()
      .int()
      .optional()
      .meta({ example: 120, description: "Optional per-key override; defaults to the server's configured limit." }),
  })
  .meta({ id: "CreateApiKeyRequest" });

/**
 * Response for POST /v1/api-keys — the ONLY shape that ever carries the
 * plaintext key. Show it once, then discard it client-side.
 */
export const ApiKeyCreateResponseSchema = z
  .object({
    apiKey: ApiKeySchema,
    key: z.string().meta({ example: "rag_live_a1b2c3d4e5f6g7h8i9j0", description: "Full plaintext key. Never returned again." }),
  })
  .meta({ id: "ApiKeyCreateResponse" });

/** Response for GET /v1/api-keys. */
export const ListApiKeysResponseSchema = z
  .object({ apiKeys: z.array(ApiKeySchema) })
  .meta({ id: "ListApiKeysResponse" });

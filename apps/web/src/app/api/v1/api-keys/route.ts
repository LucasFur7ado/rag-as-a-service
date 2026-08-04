import { desc, eq } from "drizzle-orm";
import type {
  ApiKeyCreateResponse,
  CreateApiKeyRequest,
  ListApiKeysResponse,
} from "@rag/shared";
import { requireSession } from "@/server/lib/auth";
import { handler, json, preflight, readJson } from "@/server/lib/http";
import { badRequest } from "@/server/lib/errors";
import { getDb } from "@/server/db";
import { apiKeys as apiKeysTable } from "@/server/db/schema";
import { generateApiKey, toApiKey } from "@/server/services/apikeys";
import {
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  MAX_RATE_LIMIT_PER_MINUTE,
} from "@/server/config";

/**
 * API-key management — session-only. `requireSession` rejects API-key
 * credentials, so a key can never create or revoke keys (only an interactive
 * dashboard session can).
 *
 * Keys are tenant-scoped: every query filters by the authenticated `tenantId`,
 * and a key owned by another tenant is indistinguishable from a missing one
 * (404). The plaintext key is returned ONCE, at creation, and never stored.
 */

/** Max length for a key's display name. */
const MAX_NAME_LENGTH = 100;

// --- POST /api/v1/api-keys --------------------------------------------------
// Create a key. Returns the full plaintext key exactly once.
export const POST = handler(async (req) => {
  const { auth } = await requireSession(req);
  const body = await readJson<CreateApiKeyRequest>(req);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw badRequest("`name` is required");
  if (name.length > MAX_NAME_LENGTH) {
    throw badRequest(`\`name\` exceeds ${MAX_NAME_LENGTH} characters`);
  }

  let rateLimitPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE;
  if (body.rateLimitPerMinute !== undefined) {
    const n = body.rateLimitPerMinute;
    if (!Number.isInteger(n) || n < 1 || n > MAX_RATE_LIMIT_PER_MINUTE) {
      throw badRequest(
        `\`rateLimitPerMinute\` must be an integer between 1 and ${MAX_RATE_LIMIT_PER_MINUTE}`,
      );
    }
    rateLimitPerMinute = n;
  }

  const generated = await generateApiKey();
  const row = {
    id: crypto.randomUUID(),
    tenantId: auth.tenantId,
    name,
    keyHash: generated.keyHash,
    keyPrefix: generated.keyPrefix,
    last4: generated.last4,
    rateLimitPerMinute,
    createdAt: Date.now(),
    lastUsedAt: null,
    revokedAt: null,
  };

  // Postgres is the single source of truth, and auth reads it on every request
  // (there is no cache layer to warm — see resolveApiKey in lib/auth.ts), so
  // the key is usable the instant this insert commits.
  await getDb().insert(apiKeysTable).values(row);

  const response: ApiKeyCreateResponse = {
    apiKey: toApiKey(row),
    key: generated.plaintext,
  };
  return json(response, 201);
});

// --- GET /api/v1/api-keys ---------------------------------------------------
// List the tenant's keys. Never returns key material.
export const GET = handler(async (req) => {
  const { auth } = await requireSession(req);
  const rows = await getDb()
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.tenantId, auth.tenantId))
    .orderBy(desc(apiKeysTable.createdAt));

  const response: ListApiKeysResponse = { apiKeys: rows.map(toApiKey) };
  return json(response);
});

export const OPTIONS = preflight;

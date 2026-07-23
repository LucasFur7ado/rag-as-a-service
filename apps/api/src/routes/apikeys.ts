import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq } from "drizzle-orm";
import type {
  ApiKeyCreateResponse,
  CreateApiKeyRequest,
  ListApiKeysResponse,
} from "@rag/shared";
import type { AppBindings } from "../env";
import { requireSession } from "../lib/auth";
import { getDb } from "../db";
import { apiKeys as apiKeysTable } from "../db/schema";
import {
  apiKeyCacheKey,
  generateApiKey,
  toApiKey,
  type ApiKeyCacheEntry,
} from "../services/apikeys";
import {
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  MAX_RATE_LIMIT_PER_MINUTE,
} from "../config";

/**
 * API keys API (Feature 4) — session-only management. `requireSession` rejects
 * API-key credentials, so a key can never create or revoke keys (only an
 * interactive dashboard session can).
 *
 * Keys are tenant-scoped: every query filters by the authenticated `tenantId`,
 * and a key owned by another tenant is indistinguishable from a missing one
 * (404). The plaintext key is returned ONCE, at creation, and never stored.
 */
export const apikeys = new Hono<AppBindings>();

apikeys.use("*", requireSession);

/** Max length for a key's display name. */
const MAX_NAME_LENGTH = 100;

// --- POST /v1/api-keys ------------------------------------------------------
// Create a key. Returns the full plaintext key exactly once.
apikeys.post("/", async (c) => {
  const { tenantId } = c.get("auth");

  let body: CreateApiKeyRequest;
  try {
    body = await c.req.json<CreateApiKeyRequest>();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new HTTPException(400, { message: "`name` is required" });
  if (name.length > MAX_NAME_LENGTH) {
    throw new HTTPException(400, {
      message: `\`name\` exceeds ${MAX_NAME_LENGTH} characters`,
    });
  }

  let rateLimitPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE;
  if (body.rateLimitPerMinute !== undefined) {
    const n = body.rateLimitPerMinute;
    if (!Number.isInteger(n) || n < 1 || n > MAX_RATE_LIMIT_PER_MINUTE) {
      throw new HTTPException(400, {
        message: `\`rateLimitPerMinute\` must be an integer between 1 and ${MAX_RATE_LIMIT_PER_MINUTE}`,
      });
    }
    rateLimitPerMinute = n;
  }

  const generated = await generateApiKey();
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    tenantId,
    name,
    keyHash: generated.keyHash,
    keyPrefix: generated.keyPrefix,
    last4: generated.last4,
    rateLimitPerMinute,
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
  };

  // D1 is the source of truth; write it first.
  await getDb(c.env).insert(apiKeysTable).values(row);

  // Warm the KV auth cache so the key works immediately (KV is eventually
  // consistent; the D1 fallback in auth covers any propagation lag).
  const entry: ApiKeyCacheEntry = {
    keyId: row.id,
    tenantId,
    revoked: false,
    rateLimitPerMinute,
  };
  try {
    await c.env.KV.put(apiKeyCacheKey(generated.keyHash), JSON.stringify(entry));
  } catch (err) {
    // Non-fatal: auth falls back to D1 on a KV miss.
    console.error("Failed to warm KV cache for new API key:", err);
  }

  const response: ApiKeyCreateResponse = {
    apiKey: toApiKey(row),
    key: generated.plaintext,
  };
  return c.json(response, 201);
});

// --- GET /v1/api-keys -------------------------------------------------------
// List the tenant's keys. Never returns key material.
apikeys.get("/", async (c) => {
  const { tenantId } = c.get("auth");
  const rows = await getDb(c.env)
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.tenantId, tenantId))
    .orderBy(desc(apiKeysTable.createdAt));

  const response: ListApiKeysResponse = { apiKeys: rows.map(toApiKey) };
  return c.json(response);
});

// --- DELETE /v1/api-keys/:id ------------------------------------------------
// Revoke (soft delete): set revoked_at in D1 and purge the KV entry so the key
// fails auth immediately (D1 is authoritative; a lingering KV entry is only
// possible if the purge fails, and the D1 revoked_at check still rejects it).
apikeys.delete("/:id", async (c) => {
  const { tenantId } = c.get("auth");
  const db = getDb(c.env);

  const [row] = await db
    .select()
    .from(apiKeysTable)
    .where(
      and(
        eq(apiKeysTable.id, c.req.param("id")),
        eq(apiKeysTable.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "API key not found" });

  if (row.revokedAt === null) {
    await db
      .update(apiKeysTable)
      .set({ revokedAt: Date.now() })
      .where(eq(apiKeysTable.id, row.id));
  }

  // Purge KV so the auth fast-path stops accepting it right away.
  try {
    await c.env.KV.delete(apiKeyCacheKey(row.keyHash));
  } catch (err) {
    console.error("Failed to purge KV cache on API key revoke:", err);
  }

  return c.body(null, 204);
});

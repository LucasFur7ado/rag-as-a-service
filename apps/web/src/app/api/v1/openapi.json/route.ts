import { handler, json, preflight } from "@/server/lib/http";
import { buildOpenApiDocument } from "@/server/openapi/document";
import { openApiServers } from "@/server/config";
import { publicApiUrl } from "@/server/env";

/**
 * The OpenAPI 3.1 spec — public, no auth, cached.
 *
 * Generated from the same Zod schemas in `packages/shared` that produce the
 * app's TypeScript types, so the docs, the types, and the contract cannot
 * drift. Servers come from PUBLIC_API_URL or the request origin — no
 * hardcoded URLs. Cached for 5 minutes; the spec only changes on deploy.
 */
const SPEC_CACHE_CONTROL = "public, max-age=300";

export const GET = handler(async (req) => {
  const origin = new URL(req.url).origin;
  const doc = buildOpenApiDocument(openApiServers(publicApiUrl(), origin));
  return json(doc, 200, { "Cache-Control": SPEC_CACHE_CONTROL });
});

export const OPTIONS = preflight;

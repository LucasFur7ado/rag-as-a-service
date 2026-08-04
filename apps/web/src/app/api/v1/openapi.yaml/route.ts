import { stringify as yamlStringify } from "yaml";
import { handler, preflight } from "@/server/lib/http";
import { buildOpenApiDocument } from "@/server/openapi/document";
import { openApiServers } from "@/server/config";
import { publicApiUrl } from "@/server/env";

/** The same OpenAPI 3.1 document as `openapi.json`, encoded as YAML. */
const SPEC_CACHE_CONTROL = "public, max-age=300";

export const GET = handler(async (req) => {
  const origin = new URL(req.url).origin;
  const doc = buildOpenApiDocument(openApiServers(publicApiUrl(), origin));
  return new Response(yamlStringify(doc), {
    status: 200,
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      "Cache-Control": SPEC_CACHE_CONTROL,
    },
  });
});

export const OPTIONS = preflight;

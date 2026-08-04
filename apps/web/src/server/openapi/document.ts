/**
 * Builds the OpenAPI 3.1 document from the registered operations (see
 * ./register.ts). Kept separate so both the live `openapi.json` / `openapi.yaml`
 * routes and the build-time generator (scripts/gen-openapi.ts) produce an
 * identical spec.
 *
 * The generator is `@asteasolutions/zod-to-openapi` directly. It used to be
 * reached through `@hono/zod-openapi`, which is just a Hono router bolted onto
 * the same library — with the router gone, the wrapper had nothing left to do.
 */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { OPENAPI_INFO } from "../config";
import { registerOpenApi } from "./register";

/** Tag order + descriptions, surfaced in the docs sidebar grouping. */
export const OPENAPI_TAGS = [
  { name: "Collections", description: "Create and manage collections — the knowledge bases documents are grouped into." },
  { name: "Documents", description: "Upload, inspect, re-ingest, download, and delete source documents." },
  { name: "Query", description: "Ask grounded questions and receive answers with citations (streamed or JSON)." },
  { name: "API Keys", description: "Mint and revoke programmatic API keys (dashboard session only)." },
  { name: "Analytics", description: "Usage analytics for the dashboard (session only)." },
  { name: "Health", description: "Liveness and current-principal probes." },
  { name: "Meta", description: "The OpenAPI specification itself." },
] as const;

/**
 * Produce the OpenAPI 3.1 document. `servers` is passed in so the caller can
 * derive it from the request origin / env (no hardcoded URLs).
 */
export function buildOpenApiDocument(
  servers: Array<{ url: string; description: string }>,
) {
  const registry = new OpenAPIRegistry();
  registerOpenApi(registry);
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: OPENAPI_INFO,
    servers,
    tags: [...OPENAPI_TAGS],
  });
}

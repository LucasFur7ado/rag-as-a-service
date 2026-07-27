/**
 * Minimal OpenAPI 3.1 types + helpers for the docs reference (Feature 6).
 *
 * The spec is embedded at build time from `@/generated/openapi.json` (produced
 * by `apps/api` — see its gen:openapi script). The reference renders entirely
 * from this data, so changing a Zod schema in packages/shared and regenerating
 * updates the docs with no JSX edits. `loadLiveSpec()` fetches the running
 * API's spec as a fallback / freshness check.
 */
import specJson from "@/generated/openapi.json";
import { OPENAPI_JSON_URL } from "@/lib/docs-config";

// --- Types (loose but practical) --------------------------------------------

export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  nullable?: boolean;
}

export interface ParameterObject {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

export interface MediaTypeObject {
  schema?: JsonSchema;
}

export interface RequestBodyObject {
  required?: boolean;
  content?: Record<string, MediaTypeObject>;
}

export interface HeaderObject {
  description?: string;
  schema?: { type?: string };
}

export interface ResponseObject {
  description?: string;
  headers?: Record<string, HeaderObject>;
  content?: Record<string, MediaTypeObject>;
}

export type SecurityRequirement = Record<string, string[]>;

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string; contact?: { name?: string; url?: string } };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, RawOperation>>;
  components: {
    schemas: Record<string, JsonSchema>;
    securitySchemes?: Record<string, { type: string; scheme?: string; bearerFormat?: string; description?: string }>;
  };
}

interface RawOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  security?: SecurityRequirement[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
}

/** A flattened, ready-to-render operation. */
export interface Operation {
  /** Uppercase HTTP method, e.g. "POST". */
  method: string;
  /** Templated path, e.g. "/v1/collections/{id}/query". */
  path: string;
  /** Deep-link anchor, e.g. "post-collections-id-query". */
  anchor: string;
  tag: string;
  summary?: string;
  description?: string;
  security?: SecurityRequirement[];
  parameters: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"] as const;

export const spec = specJson as unknown as OpenApiDocument;

/** Stable, shareable anchor for an operation (`method-path-segments`). */
export function operationAnchor(method: string, path: string): string {
  const segments = path
    .split("/")
    .filter(Boolean)
    .filter((s) => s !== "v1")
    .map((s) => s.replace(/[{}]/g, ""));
  return [method.toLowerCase(), ...segments].join("-").replace(/[^a-z0-9-]/g, "-");
}

/** Flatten `paths` into a list of operations, in document order. */
export function listOperations(doc: OpenApiDocument = spec): Operation[] {
  const ops: Operation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const raw = item[method];
      if (!raw) continue;
      ops.push({
        method: method.toUpperCase(),
        path,
        anchor: operationAnchor(method, path),
        tag: raw.tags?.[0] ?? "Other",
        summary: raw.summary,
        description: raw.description,
        security: raw.security,
        parameters: raw.parameters ?? [],
        requestBody: raw.requestBody,
        responses: raw.responses,
      });
    }
  }
  return ops;
}

export interface TagGroup {
  name: string;
  description?: string;
  operations: Operation[];
}

/** Group operations by their first tag, honoring the spec's tag order. */
export function groupByTag(doc: OpenApiDocument = spec): TagGroup[] {
  const ops = listOperations(doc);
  const order = (doc.tags ?? []).map((t) => t.name);
  const byName = new Map<string, TagGroup>();
  const tagInfo = new Map((doc.tags ?? []).map((t) => [t.name, t.description] as const));

  for (const op of ops) {
    let group = byName.get(op.tag);
    if (!group) {
      group = { name: op.tag, description: tagInfo.get(op.tag), operations: [] };
      byName.set(op.tag, group);
    }
    group.operations.push(op);
  }
  return [...byName.values()].sort(
    (a, b) => (order.indexOf(a.name) + 1 || 999) - (order.indexOf(b.name) + 1 || 999),
  );
}

/** Resolve a local `#/components/schemas/X` reference to its schema. */
export function resolveRef(ref: string, doc: OpenApiDocument = spec): JsonSchema | undefined {
  const name = ref.replace(/^#\/components\/schemas\//, "");
  return doc.components.schemas[name];
}

/** If `schema` is a `$ref`, return `{ name, schema }`; otherwise `{ schema }`. */
export function deref(
  schema: JsonSchema | undefined,
  doc: OpenApiDocument = spec,
): { name?: string; schema?: JsonSchema } {
  if (!schema) return {};
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/components\/schemas\//, "");
    return { name, schema: resolveRef(schema.$ref, doc) };
  }
  return { schema };
}

/** Human label for the auth schemes an operation accepts. */
export function authLabel(op: Operation): { label: string; schemes: string[] } {
  const schemes = (op.security ?? []).flatMap((req) => Object.keys(req));
  if (schemes.length === 0) return { label: "Public — no authentication", schemes: [] };
  const nice = schemes.map((s) => (s === "ApiKeyAuth" ? "API key" : s === "SessionAuth" ? "Session" : s));
  return { label: nice.join(" or "), schemes };
}

/** Fetch the running API's spec (client-side fallback / freshness check). */
export async function loadLiveSpec(): Promise<OpenApiDocument | null> {
  try {
    const res = await fetch(OPENAPI_JSON_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as OpenApiDocument;
  } catch {
    return null;
  }
}

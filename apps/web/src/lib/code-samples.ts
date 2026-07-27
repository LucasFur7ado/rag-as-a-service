/**
 * Generate copy-pasteable code samples (curl / TypeScript / Python) for an
 * OpenAPI operation (Feature 6). Everything is derived from the embedded spec —
 * path/query/body examples come from the schemas — so samples stay accurate
 * when a schema changes. The same {@link RequestModel} powers the "Try it"
 * console's editable request and its equivalent-curl preview.
 */
import { API_KEY_PLACEHOLDER } from "@/lib/docs-config";
import { deref, type JsonSchema, type Operation } from "@/lib/openapi";

/** A concrete, renderable HTTP request. */
export interface RequestModel {
  method: string;
  /** Full URL including any query string. */
  url: string;
  headers: Record<string, string>;
  /** Parsed JSON body (for application/json endpoints). */
  bodyObject?: unknown;
  /** True for multipart file uploads (curl `-F file=@…`). */
  multipart?: boolean;
}

/** Build an example value for a schema, preferring declared examples. */
export function exampleForSchema(schema: JsonSchema | undefined, seen = 0): unknown {
  const { schema: s } = deref(schema);
  if (!s || seen > 6) return null;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.enum && s.enum.length) return s.enum[0];

  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const type = types.find((t) => t !== "null");

  if (s.properties) {
    const obj: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(s.properties)) {
      obj[key] = exampleForSchema(prop, seen + 1);
    }
    return obj;
  }
  if (type === "array") return s.items ? [exampleForSchema(s.items, seen + 1)] : [];
  if (type === "string") return s.format === "binary" ? "<file>" : "string";
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  if (types.includes("null")) return null;
  return null;
}

/** The request body's JSON schema, if the operation takes application/json. */
function jsonBodySchema(op: Operation): JsonSchema | undefined {
  return op.requestBody?.content?.["application/json"]?.schema;
}

function isMultipart(op: Operation): boolean {
  return Boolean(op.requestBody?.content?.["multipart/form-data"]);
}

/** Substitute `{param}` path segments with their example values. */
export function fillPath(op: Operation, overrides: Record<string, string> = {}): string {
  let path = op.path;
  for (const p of op.parameters.filter((x) => x.in === "path")) {
    const value = overrides[p.name] ?? String(exampleForSchema(p.schema) ?? p.name);
    path = path.replace(`{${p.name}}`, encodeURIComponent(value));
  }
  return path;
}

/** Query string from parameters that are required or have an example. */
export function buildQuery(op: Operation, overrides: Record<string, string> = {}): string {
  const qs = new URLSearchParams();
  for (const p of op.parameters.filter((x) => x.in === "query")) {
    const override = overrides[p.name];
    const ex = override ?? (p.schema?.example as string | undefined);
    if (ex === undefined || ex === "") {
      if (!p.required) continue;
    }
    qs.set(p.name, override ?? String(ex ?? ""));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** Choose the auth header for the sample based on the operation's schemes. */
function authHeader(op: Operation): Record<string, string> {
  const schemes = (op.security ?? []).flatMap((r) => Object.keys(r));
  if (schemes.length === 0) return {};
  if (schemes.includes("ApiKeyAuth")) {
    return { Authorization: `Bearer ${API_KEY_PLACEHOLDER}` };
  }
  return { Authorization: "Bearer <clerk-session-jwt>" };
}

/** Build the example request for an operation against `baseUrl`. */
export function buildRequestModel(op: Operation, baseUrl: string): RequestModel {
  const url = `${baseUrl}${fillPath(op)}${buildQuery(op)}`;
  const headers: Record<string, string> = { ...authHeader(op) };
  const multipart = isMultipart(op);
  const bodySchema = jsonBodySchema(op);
  let bodyObject: unknown;

  if (multipart) {
    // handled by curl -F / FormData below
  } else if (bodySchema) {
    headers["Content-Type"] = "application/json";
    bodyObject = exampleForSchema(bodySchema);
  }
  return { method: op.method, url, headers, bodyObject, multipart };
}

// --- Renderers ---------------------------------------------------------------

/** Render `req` as a curl command. */
export function curlFor(req: RequestModel): string {
  const parts = [`curl -X ${req.method} '${req.url}'`];
  for (const [k, v] of Object.entries(req.headers)) parts.push(`-H '${k}: ${v}'`);
  if (req.multipart) parts.push(`-F 'file=@./handbook.pdf'`);
  else if (req.bodyObject !== undefined) parts.push(`-d '${JSON.stringify(req.bodyObject)}'`);
  return parts.join(" \\\n  ");
}

/** Render `req` as a TypeScript `fetch` snippet. */
export function tsFor(req: RequestModel): string {
  const headers = JSON.stringify(req.headers, null, 2).replace(/\n/g, "\n  ");
  const lines: string[] = [];
  if (req.multipart) {
    lines.push(`const form = new FormData();`);
    lines.push(`form.append("file", fileInput.files[0]);`);
    lines.push(``);
    lines.push(`const res = await fetch("${req.url}", {`);
    lines.push(`  method: "${req.method}",`);
    lines.push(`  headers: ${headers},`);
    lines.push(`  body: form,`);
    lines.push(`});`);
  } else {
    lines.push(`const res = await fetch("${req.url}", {`);
    lines.push(`  method: "${req.method}",`);
    lines.push(`  headers: ${headers},`);
    if (req.bodyObject !== undefined) {
      const body = JSON.stringify(req.bodyObject, null, 2).replace(/\n/g, "\n  ");
      lines.push(`  body: JSON.stringify(${body}),`);
    }
    lines.push(`});`);
  }
  lines.push(`const data = await res.json();`);
  lines.push(`console.log(data);`);
  return lines.join("\n");
}

/** Render `req` as a Python `requests` snippet. */
export function pythonFor(req: RequestModel): string {
  const method = req.method.toLowerCase();
  const headers = pyDict(req.headers, 1);
  const lines = [`import requests`, ``, `resp = requests.${method}(`, `    "${req.url}",`];
  if (Object.keys(req.headers).length) lines.push(`    headers=${headers},`);
  if (req.multipart) lines.push(`    files={"file": open("handbook.pdf", "rb")},`);
  else if (req.bodyObject !== undefined) lines.push(`    json=${pyValue(req.bodyObject, 1)},`);
  lines.push(`)`, `print(resp.json())`);
  return lines.join("\n");
}

// --- Python literal helpers --------------------------------------------------

function pyValue(value: unknown, indent: number): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inner = value.map((v) => pad(indent + 1) + pyValue(v, indent + 1)).join(",\n");
    return `[\n${inner}\n${pad(indent)}]`;
  }
  if (typeof value === "object") return pyDict(value as Record<string, unknown>, indent);
  return "None";
}

function pyDict(obj: Record<string, unknown>, indent: number): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  const inner = keys
    .map((k) => `${pad(indent + 1)}${JSON.stringify(k)}: ${pyValue(obj[k], indent + 1)}`)
    .join(",\n");
  return `{\n${inner}\n${pad(indent)}}`;
}

function pad(n: number): string {
  return "    ".repeat(n);
}

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EVAL_ROOT } from "../config";

/**
 * Environment loading and credential preflight for the harness.
 *
 * `next dev` loads `.env.local` for you; a plain tsx script gets nothing, so
 * the harness loads the same file itself and reads exactly the same variables
 * through src/server/env.ts. There is no eval-specific credential.
 *
 * Ordering note: none of the modules this harness imports read `process.env` at
 * import time — `env.ts` only declares accessor functions, and the Pinecone
 * client reads its config in the constructor — so calling `loadEnvFiles()` at
 * the top of `main()` is early enough, even with static imports above it.
 */

/** Files checked, in order. Later files do not overwrite earlier ones. */
const ENV_FILES = [".env.local", ".env"];

/**
 * Minimal `.env` parser: `KEY=value`, `#` comments, optional `export` prefix,
 * and single/double quoted values. Deliberately not a dependency — the format
 * this needs to read is the one in `.env.example`, and nothing more.
 */
function parseEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equalsAt = withoutExport.indexOf("=");
    if (equalsAt <= 0) continue;

    const key = withoutExport.slice(0, equalsAt).trim();
    let value = withoutExport.slice(equalsAt + 1).trim();

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
    } else {
      // Strip a trailing inline comment only on unquoted values, where a `#`
      // cannot legitimately be part of the value.
      const commentAt = value.indexOf(" #");
      if (commentAt !== -1) value = value.slice(0, commentAt).trim();
    }
    values[key] = value;
  }
  return values;
}

/**
 * Load `.env.local` / `.env` from apps/web into `process.env`.
 *
 * A variable already present in the real environment always wins, so CI or a
 * shell export can override the file without editing it.
 */
export function loadEnvFiles(): void {
  const webRoot = resolve(EVAL_ROOT, "..");
  for (const file of ENV_FILES) {
    const path = resolve(webRoot, file);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

/** A credential the harness cannot run without. */
interface RequiredCredential {
  name: string;
  hint: string;
}

const AI_CREDENTIALS: RequiredCredential[] = [
  {
    name: "CLOUDFLARE_ACCOUNT_ID",
    hint: "Cloudflare dashboard → Workers & Pages → Account ID",
  },
  {
    name: "CLOUDFLARE_API_TOKEN",
    hint: "My Profile → API Tokens → 'Workers AI' template",
  },
];

const VECTOR_CREDENTIALS: RequiredCredential[] = [
  { name: "PINECONE_API_KEY", hint: "Pinecone console → API Keys" },
  { name: "PINECONE_INDEX_HOST", hint: "Pinecone console → your index → Host" },
];

/**
 * Fail fast, and legibly, when credentials are missing.
 *
 * The deterministic vitest suite runs without any secret and must keep doing
 * so. This harness is the opposite: it calls real models against a real index,
 * so an unset token is a setup mistake to report up front rather than a 401
 * three minutes into a run that has already spent quota.
 */
export function requireCredentials(options: { ai: boolean; vectors: boolean }): void {
  const needed = [
    ...(options.ai ? AI_CREDENTIALS : []),
    ...(options.vectors ? VECTOR_CREDENTIALS : []),
  ];
  const missing = needed.filter(({ name }) => !process.env[name]?.trim());
  if (missing.length === 0) return;

  const lines = missing.map(({ name, hint }) => `  - ${name}  (${hint})`);
  throw new Error(
    `The evaluation harness needs real credentials and these are not set:\n${lines.join("\n")}\n\n` +
      `Copy apps/web/.env.example to apps/web/.env.local and fill them in.\n` +
      `Unlike \`pnpm test\`, this harness calls live APIs and spends Workers AI quota.`,
  );
}

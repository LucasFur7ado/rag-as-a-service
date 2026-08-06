import "server-only";

/**
 * Server-side environment access.
 *
 * On Vercel every value below is a Project Environment Variable read at
 * request time from `process.env`. Properties are accessed statically (never
 * `process.env[name]`) so Next's bundler can see every reference.
 *
 * Nothing here is ever imported from a Client Component — `server-only` makes
 * an accidental import a build error rather than a leaked secret.
 */

/** Thrown when a required variable is missing; surfaces as a 500, never a 401. */
export class MissingEnvError extends Error {
  constructor(name: string, hint: string) {
    super(`${name} is not configured — ${hint}`);
    this.name = "MissingEnvError";
  }
}

function required(value: string | undefined, name: string, hint: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new MissingEnvError(name, hint);
  return trimmed;
}

/** Neon Postgres connection string (pooled URL from the Vercel integration). */
export function databaseUrl(): string {
  return required(
    process.env.DATABASE_URL,
    "DATABASE_URL",
    "set it to the Neon pooled connection string (see README → Environment setup)",
  );
}

/** Clerk Frontend API URL, e.g. https://your-app.clerk.accounts.dev */
export function clerkIssuer(): string {
  return required(
    process.env.CLERK_ISSUER,
    "CLERK_ISSUER",
    "set it to your Clerk Frontend API URL",
  );
}

/**
 * Origin(s) of our own frontend, comma-separated — checked against the session
 * token's `azp` claim. `iss` only proves the token came from our Clerk
 * INSTANCE; `azp` is what pins it to our app, so auth fails closed when this is
 * unset (see verifyClerkToken in server/lib/auth.ts).
 */
export function clerkAuthorizedParties(): string[] {
  const raw = required(
    process.env.CLERK_AUTHORIZED_PARTY,
    "CLERK_AUTHORIZED_PARTY",
    "set it to the web app's origin(s), comma-separated. See README → Environment setup",
  );
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Google AI Studio API key — powers answer generation. */
export function geminiApiKey(): string {
  return required(
    process.env.GEMINI_API_KEY,
    "GEMINI_API_KEY",
    "create one at https://aistudio.google.com/apikey (free tier)",
  );
}

/**
 * Cloudflare account id that owns the Workers AI allocation used for
 * embeddings. Only the REST API is used — this app deploys no Worker and needs
 * no `wrangler`, no AI binding, and no Cloudflare runtime.
 */
export function cloudflareAccountId(): string {
  return required(
    process.env.CLOUDFLARE_ACCOUNT_ID,
    "CLOUDFLARE_ACCOUNT_ID",
    "copy it from the Cloudflare dashboard sidebar (Workers & Pages → Account ID)",
  );
}

/** Cloudflare API token with the Workers AI Read + Edit permissions. */
export function cloudflareApiToken(): string {
  return required(
    process.env.CLOUDFLARE_API_TOKEN,
    "CLOUDFLARE_API_TOKEN",
    "create one from the 'Workers AI' template at dashboard.cloudflare.com → My Profile → API Tokens",
  );
}

/** Pinecone data-plane credentials. */
export function pineconeConfig(): { apiKey: string; host: string; index: string } {
  const apiKey = required(
    process.env.PINECONE_API_KEY,
    "PINECONE_API_KEY",
    "create one in the Pinecone console",
  );
  const rawHost = required(
    process.env.PINECONE_INDEX_HOST,
    "PINECONE_INDEX_HOST",
    "copy the index host from the Pinecone console (see README → Pinecone setup)",
  );
  if (rawHost.includes("your-index-host")) {
    throw new MissingEnvError(
      "PINECONE_INDEX_HOST",
      "it still holds the placeholder value from .env.example",
    );
  }
  return {
    apiKey,
    // Accept the host with or without a scheme (the console shows it bare).
    host: rawHost.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    index: process.env.PINECONE_INDEX?.trim() ?? "",
  };
}

/**
 * Public/production base URL of this API, advertised as the primary server in
 * the generated OpenAPI spec. Optional — the spec falls back to the request
 * origin. No trailing slash; includes the `/api` prefix.
 */
export function publicApiUrl(): string | undefined {
  return process.env.PUBLIC_API_URL?.trim() || undefined;
}

/**
 * Extra origins allowed to call the API cross-origin (comma-separated).
 *
 * The dashboard is same-origin now, so CORS is only about programmatic
 * API-key callers from a browser. Empty by default: server-to-server callers
 * (curl, backends) are unaffected by CORS.
 */
export function corsAllowedOrigins(): string[] {
  return (process.env.API_CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Shared secret Vercel Cron sends as `Authorization: Bearer <CRON_SECRET>`.
 * Required in production so the prune endpoint is not publicly triggerable.
 */
export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET?.trim() || undefined;
}

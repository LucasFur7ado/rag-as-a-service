import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config — used ONLY to generate SQL migrations from src/db/schema.ts:
 *
 *   pnpm --filter api exec drizzle-kit generate
 *
 * Migrations are applied with Wrangler (not drizzle-kit), so no DB credentials
 * are needed here:
 *
 *   wrangler d1 migrations apply rag-db --local    # local dev (miniflare)
 *   wrangler d1 migrations apply rag-db --remote   # production
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});

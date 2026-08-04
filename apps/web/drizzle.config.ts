import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config.
 *
 * Generate SQL migrations from the schema:
 *   pnpm --filter web db:generate
 *
 * Apply them (needs DATABASE_URL in the environment):
 *   pnpm --filter web db:migrate
 *
 * Migrations are applied by scripts/migrate.ts rather than `drizzle-kit
 * migrate` so CI can run them with the same Neon HTTP driver the app uses,
 * with no extra credentials or tooling.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});

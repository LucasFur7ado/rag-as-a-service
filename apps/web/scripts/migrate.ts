/**
 * Apply pending Drizzle migrations to the Neon database in `DATABASE_URL`.
 *
 * Uses the same `neon-http` driver the app itself uses, so CI needs no
 * additional client, connection string format, or native dependency. Already-
 * applied migrations are skipped (drizzle tracks them in its own table), so
 * this is safe to run on every deploy.
 *
 * Usage:  DATABASE_URL=postgres://… tsx scripts/migrate.ts
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set — nothing to migrate against.");
    process.exit(1);
  }

  const db = drizzle(neon(url));
  await migrate(db, { migrationsFolder: resolve(here, "../drizzle") });
  console.log("✓ migrations applied");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

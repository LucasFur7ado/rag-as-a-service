import { lt } from "drizzle-orm";
import type { Env } from "../env";
import { getDb } from "../db";
import { usageEvents } from "../db/schema";
import { ANALYTICS_RETENTION_DAYS } from "../config";

/**
 * Delete `usage_events` older than the configured retention window
 * ({@link ANALYTICS_RETENTION_DAYS}). Invoked by the daily cron trigger (see
 * the `scheduled` handler in src/index.ts and `triggers.crons` in
 * wrangler.jsonc).
 *
 * Returns the cutoff used (epoch ms) for logging/observability. Deletion is a
 * single indexed range delete on `created_at`.
 */
export async function pruneUsageEvents(env: Env): Promise<{ cutoff: number }> {
  const cutoff = Date.now() - ANALYTICS_RETENTION_DAYS * 86_400_000;
  await getDb(env).delete(usageEvents).where(lt(usageEvents.createdAt, cutoff));
  return { cutoff };
}

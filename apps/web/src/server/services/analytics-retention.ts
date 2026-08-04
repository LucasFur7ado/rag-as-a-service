import "server-only";

import { lt } from "drizzle-orm";
import { getDb } from "../db";
import { usageEvents } from "../db/schema";
import { ANALYTICS_RETENTION_DAYS, RATE_LIMIT_ROW_TTL_MS } from "../config";
import { pruneRateLimits } from "./ratelimit";

/**
 * Delete `usage_events` older than the configured retention window
 * ({@link ANALYTICS_RETENTION_DAYS}), and sweep idle rate-limit rows.
 *
 * Invoked by the daily Vercel Cron job (see vercel.json and
 * app/api/cron/prune/route.ts). Returns the cutoffs used (epoch ms) for
 * logging/observability. Both deletions are single indexed range deletes.
 */
export async function pruneRetention(): Promise<{
  eventsCutoff: number;
  rateLimitCutoff: number;
}> {
  const eventsCutoff = Date.now() - ANALYTICS_RETENTION_DAYS * 86_400_000;
  await getDb().delete(usageEvents).where(lt(usageEvents.createdAt, eventsCutoff));
  const { cutoff: rateLimitCutoff } = await pruneRateLimits(RATE_LIMIT_ROW_TTL_MS);
  return { eventsCutoff, rateLimitCutoff };
}

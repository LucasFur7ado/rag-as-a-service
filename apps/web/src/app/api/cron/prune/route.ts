import { handler, json } from "@/server/lib/http";
import { unauthorized } from "@/server/lib/errors";
import { cronSecret } from "@/server/env";
import { pruneRetention } from "@/server/services/analytics-retention";

/**
 * Daily retention sweep (Vercel Cron — see `crons` in vercel.json).
 *
 * Deletes `usage_events` past ANALYTICS_RETENTION_DAYS and drops idle
 * `rate_limits` rows. A missed run simply retries on the next tick; it never
 * affects request traffic.
 *
 * **This endpoint is publicly routable, so it authenticates.** Vercel Cron
 * sends `Authorization: Bearer $CRON_SECRET` when the variable is set, and the
 * route refuses to run without a match — otherwise anyone who guessed the path
 * could trigger unbounded deletes. It fails closed when CRON_SECRET is unset,
 * so a deploy that forgets it gets 401s in the cron log rather than an open
 * door.
 */
export const maxDuration = 60;

export const GET = handler(async (req) => {
  const secret = cronSecret();
  const presented = req.headers.get("Authorization");
  if (!secret || presented !== `Bearer ${secret}`) {
    throw unauthorized("Invalid or missing cron credentials");
  }

  const { eventsCutoff, rateLimitCutoff } = await pruneRetention();
  console.log(
    `[cron] pruned usage_events < ${new Date(eventsCutoff).toISOString()}, ` +
      `rate_limits < ${new Date(rateLimitCutoff).toISOString()}`,
  );
  return json({ ok: true, eventsCutoff, rateLimitCutoff });
});

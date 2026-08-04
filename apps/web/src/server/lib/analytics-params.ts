import "server-only";

import type { AuthContext } from "@rag/shared";
import { ANALYTICS_DEFAULT_RANGE_DAYS } from "../config";
import { badRequest } from "./errors";
import type { RangeFilter } from "../services/analytics-queries";

/**
 * Shared query-string parsing for the analytics endpoints. Every one of them
 * accepts `from`, `to` (epoch ms or ISO-8601) and an optional `collectionId`;
 * the tenant always comes from the verified session, never from the client.
 */

const DAY_MS = 86_400_000;

/** Parse an epoch-ms or ISO-8601 timestamp; undefined when absent/invalid. */
function parseTimestamp(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Resolve the shared range + collection filter. Defaults to the last
 * {@link ANALYTICS_DEFAULT_RANGE_DAYS} days when `from`/`to` are omitted.
 * Rejects an inverted or absurd range with 400.
 */
export function parseRange(req: Request, auth: AuthContext): RangeFilter {
  const params = new URL(req.url).searchParams;
  const now = Date.now();
  const to = parseTimestamp(params.get("to")) ?? now;
  const from =
    parseTimestamp(params.get("from")) ?? to - ANALYTICS_DEFAULT_RANGE_DAYS * DAY_MS;

  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw badRequest("Invalid range: `from` must be a valid timestamp before `to`");
  }

  return {
    tenantId: auth.tenantId,
    from,
    to,
    collectionId: params.get("collectionId")?.trim() || null,
  };
}

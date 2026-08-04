import { rateLimitHeaders, requireAuth } from "@/server/lib/auth";
import { handler, json, preflight } from "@/server/lib/http";

/** Protected: returns the authenticated principal (session JWT or API key). */
export const GET = handler(async (req) => {
  const { auth, rateLimit } = await requireAuth(req);
  return json(auth, 200, rateLimit ? rateLimitHeaders(rateLimit) : {});
});

export const OPTIONS = preflight;

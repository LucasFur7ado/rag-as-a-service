import { handler, json, preflight } from "@/server/lib/http";
import { VERSION } from "@/server/version";

/** Public health check. No authentication required. */
export const GET = handler(async () =>
  json({ status: "ok", version: VERSION, service: "rag-api" }),
);

export const OPTIONS = preflight;

import { Hono } from "hono";
import type { AppBindings } from "../env";
import { requireAuth } from "../lib/auth";

/**
 * API keys API (protected). Issue/list/revoke per-tenant API keys (stored in KV).
 * TODO: implement key generation + storage. Returns 501 Not Implemented for now.
 */
export const apikeys = new Hono<AppBindings>();

apikeys.use("*", requireAuth);

// TODO: POST "/" create, GET "/" list, DELETE "/:id" revoke.
apikeys.all("*", (c) =>
  c.json({ error: "Not Implemented", resource: "apikeys" }, 501),
);

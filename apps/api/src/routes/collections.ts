import { Hono } from "hono";
import type { AppBindings } from "../env";
import { requireAuth } from "../lib/auth";

/**
 * Collections API (protected). CRUD over a tenant's collections.
 * TODO: implement. All handlers currently return 501 Not Implemented.
 */
export const collections = new Hono<AppBindings>();

collections.use("*", requireAuth);

// TODO: GET "/" list, POST "/" create, GET "/:id", PATCH "/:id", DELETE "/:id".
collections.all("*", (c) =>
  c.json({ error: "Not Implemented", resource: "collections" }, 501),
);

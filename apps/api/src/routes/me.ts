import { Hono } from "hono";
import type { AppBindings } from "../env";
import { requireAuth } from "../lib/auth";

/** Protected: returns the authenticated principal derived from the Clerk JWT. */
export const me = new Hono<AppBindings>();

me.use("*", requireAuth);

me.get("/", (c) => {
  const auth = c.get("auth");
  return c.json(auth);
});

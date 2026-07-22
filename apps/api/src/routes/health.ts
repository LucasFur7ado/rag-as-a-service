import { Hono } from "hono";
import type { AppBindings } from "../env";
import { VERSION } from "../version";

/** Public health check. No auth required. */
export const health = new Hono<AppBindings>();

health.get("/", (c) =>
  c.json({ status: "ok", version: VERSION, service: "rag-api" }),
);

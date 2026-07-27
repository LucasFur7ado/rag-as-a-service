/**
 * Build-time OpenAPI generator (Feature 6).
 *
 * Produces the exact same OpenAPI 3.1 document the Worker serves at
 * `/v1/openapi.json`, without importing the Worker runtime (no `cloudflare:*`
 * imports are pulled in — only the pure schema + registration modules). Writes
 * it into `apps/web` so the docs reference + code samples can be rendered and
 * syntax-highlighted at static-export build time, and validates it so a broken
 * spec fails the build.
 *
 * Usage:  tsx scripts/gen-openapi.ts            # write + validate
 *         tsx scripts/gen-openapi.ts --stdout   # print to stdout instead
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { validate as validateOpenApi } from "@readme/openapi-parser";
import { registerOpenApi } from "../src/openapi/register";
import { buildOpenApiDocument } from "../src/openapi/document";
import { openApiServers } from "../src/config";
import type { AppBindings } from "../src/env";

const OUT = resolve(process.cwd(), "../web/src/generated/openapi.json");

async function main() {
  const app = new OpenAPIHono<AppBindings>();
  registerOpenApi(app);
  const doc = buildOpenApiDocument(app, openApiServers(process.env.PUBLIC_API_URL));
  const jsonText = JSON.stringify(doc, null, 2);

  // Validate the generated document as OpenAPI 3.1 (clone: the validator
  // dereferences its input in place).
  const result = await validateOpenApi(structuredClone(doc) as never);
  if (!result.valid) {
    console.error("OpenAPI validation failed:");
    for (const e of result.errors ?? []) console.error(`  • ${e.message}`);
    process.exit(1);
  }

  if (process.argv.includes("--stdout")) {
    process.stdout.write(jsonText + "\n");
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, jsonText + "\n", "utf8");
  const pathCount = Object.keys(doc.paths ?? {}).length;
  console.log(`✓ OpenAPI ${doc.openapi} valid — ${pathCount} paths → ${OUT}`);
}

main().catch((err) => {
  console.error("OpenAPI generation failed:", err);
  process.exit(1);
});

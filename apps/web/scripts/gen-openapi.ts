/**
 * Build-time OpenAPI generator.
 *
 * Produces the exact same OpenAPI 3.1 document the API serves at
 * `/api/v1/openapi.json`, without booting Next: it imports only the pure
 * schema + registration modules, none of which touch `server-only`, the
 * database, or the environment. The result is written into `src/generated/` so
 * the docs reference and its code samples can be rendered and syntax-
 * highlighted at build time, and it is validated so a broken spec fails the
 * build rather than shipping.
 *
 * Usage:  tsx scripts/gen-openapi.ts            # write + validate
 *         tsx scripts/gen-openapi.ts --stdout   # print to stdout instead
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate as validateOpenApi } from "@readme/openapi-parser";
import { buildOpenApiDocument } from "../src/server/openapi/document";
import { openApiServers } from "../src/server/config";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../src/generated/openapi.json");

async function main() {
  const doc = buildOpenApiDocument(openApiServers(process.env.PUBLIC_API_URL));
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

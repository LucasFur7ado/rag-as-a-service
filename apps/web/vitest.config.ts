import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is a build-time guard: its default entry throws so that
      // importing a server module from a Client Component fails loudly, and
      // Next swaps it for an empty module under the `react-server` condition.
      // Vitest resolves neither, so it is stubbed here — the tests exercise
      // pure functions from those modules, which is exactly what the guard is
      // meant to allow.
      "server-only": fileURLToPath(
        new URL("./src/server/__mocks__/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // `eval/` is a standalone, non-deterministic harness that spends real API
    // quota — it is NOT part of this suite and is never run by CI. Its metric
    // and relevance math, however, is pure and is exactly the part that must
    // not silently drift, so those files (and only those) are included here.
    include: ["src/**/*.test.ts", "eval/**/*.test.ts"],
  },
});

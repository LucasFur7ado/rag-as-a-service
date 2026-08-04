/**
 * Test stub for the `server-only` package.
 *
 * The real module throws on import so that pulling a server module into a
 * Client Component is a build error. Vitest runs plain Node with no
 * `react-server` condition, so it would hit that throw; this empty module
 * stands in (wired up via the alias in vitest.config.ts).
 */
export {};

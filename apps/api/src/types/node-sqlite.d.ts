/**
 * Minimal ambient types for `node:sqlite` (Node >= 22), used by tests only.
 *
 * This package typechecks against `@cloudflare/workers-types` and deliberately
 * does NOT depend on `@types/node` — pulling it in would put two conflicting
 * sets of global declarations in scope. The tests need real SQLite semantics
 * (see analytics-queries.test.ts), so we declare just the sliver they touch.
 */
declare module "node:sqlite" {
  export interface StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): unknown;
  }

  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

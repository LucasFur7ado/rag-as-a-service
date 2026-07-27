import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { BUCKET_EXPR, bucketStart } from "./analytics-queries";

/**
 * Time-bucketing contract for the analytics time series.
 *
 * REGRESSION: the bucket size is a *bound parameter*, and a JavaScript number
 * binds as a SQLite REAL — which turns `created_at / ?5` into floating-point
 * division. `(x / n) * n` then returns `x`, so every event got its own bucket
 * and none of them matched the boundaries `getTimeseries` iterates when it
 * fills the continuous series. The endpoint returned a full, well-formed
 * series of zeros and the dashboard rendered "No queries yet" on top of real
 * data.
 *
 * These tests therefore BIND the divisor rather than interpolating it: a SQL
 * literal is parsed as an INTEGER and takes the integer-division path the
 * broken code never reached, so a literal-based test passes either way.
 *
 * `node:sqlite` stands in for D1 here. Both bind JS numbers as doubles (the
 * first test asserts that precondition, so this stops being a silent
 * assumption), and the CAST is correct under either binding regardless.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** 2026-07-24T00:00:00Z — a day boundary, for readable expectations. */
const JUL_24 = Date.UTC(2026, 6, 24);

let db: DatabaseSync | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

/** In-memory `usage_events` holding just the columns these queries touch. */
function seed(timestamps: number[]): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE usage_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      collection_id TEXT
    )
  `);
  const insert = database.prepare(
    `INSERT INTO usage_events (id, tenant_id, event_type, created_at, collection_id)
     VALUES (?, 't1', 'query', ?, NULL)`,
  );
  timestamps.forEach((ts, i) => insert.run(String(i), ts));
  db = database;
  return database;
}

/** Run the production bucket expression with the divisor bound, as D1 does. */
function bucketCounts(
  database: DatabaseSync,
  from: number,
  to: number,
  bucketMs: number,
): { bucket: number; n: number }[] {
  return database
    .prepare(
      `SELECT ${BUCKET_EXPR} AS bucket, COUNT(*) AS n
       FROM usage_events
       WHERE tenant_id = ?1
         AND event_type = 'query'
         AND created_at >= ?2
         AND created_at < ?3
         AND (?4 IS NULL OR collection_id = ?4)
       GROUP BY bucket
       ORDER BY bucket`,
    )
    .all("t1", from, to, null, bucketMs) as unknown as {
    bucket: number;
    n: number;
  }[];
}

describe("time bucketing", () => {
  it("binds a JS number as a REAL — the precondition this bug rests on", () => {
    const database = seed([]);
    const [row] = database
      .prepare("SELECT typeof(?) AS t, 7 / ? AS quotient")
      .all(DAY_MS, DAY_MS);

    expect(row.t).toBe("real");
    // Float division, not SQLite's integer division (which would give 0).
    expect(row.quotient).toBeGreaterThan(0);
    expect(row.quotient).toBeLessThan(1);
  });

  it("floors events to their day boundary with a bound divisor", () => {
    const database = seed([
      JUL_24 + 1, // just after midnight
      JUL_24 + 15 * HOUR_MS,
      JUL_24 + DAY_MS - 1, // last ms of the day
      JUL_24 + 3 * DAY_MS + HOUR_MS, // three days later
    ]);

    expect(bucketCounts(database, JUL_24, JUL_24 + 7 * DAY_MS, DAY_MS)).toEqual([
      { bucket: JUL_24, n: 3 },
      { bucket: JUL_24 + 3 * DAY_MS, n: 1 },
    ]);
  });

  it("floors events to their hour boundary with a bound divisor", () => {
    const database = seed([
      JUL_24 + 60_000,
      JUL_24 + HOUR_MS - 1,
      JUL_24 + HOUR_MS + 60_000,
    ]);

    expect(bucketCounts(database, JUL_24, JUL_24 + DAY_MS, HOUR_MS)).toEqual([
      { bucket: JUL_24, n: 2 },
      { bucket: JUL_24 + HOUR_MS, n: 1 },
    ]);
  });

  it("returns buckets the fill loop actually iterates", () => {
    // The invariant that broke: SQL bucket keys must be findable among the
    // boundaries getTimeseries() walks, or every point falls back to zero.
    const from = JUL_24 + 9 * HOUR_MS; // deliberately not on a boundary
    const to = from + 5 * DAY_MS;
    const database = seed([from + HOUR_MS, from + 2 * DAY_MS]);

    const boundaries = new Set<number>();
    for (
      let b = bucketStart(from, DAY_MS);
      b <= bucketStart(to - 1, DAY_MS);
      b += DAY_MS
    ) {
      boundaries.add(b);
    }

    const rows = bucketCounts(database, from, to, DAY_MS);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(boundaries.has(row.bucket)).toBe(true);
    }
  });
});

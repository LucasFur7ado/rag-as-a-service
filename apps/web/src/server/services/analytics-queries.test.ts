import { describe, expect, it } from "vitest";
import { bucketStart, pickGranularity } from "./analytics-queries";

/**
 * Time-bucketing contract for the analytics time series.
 *
 * The invariant under test: `getTimeseries` walks bucket boundaries with
 * {@link bucketStart} and looks each one up in a map keyed by whatever the SQL
 * `bucketExpr` produced. If the two ever disagree, every lookup misses, the
 * endpoint returns a full well-formed series of zeros, and the dashboard
 * renders "No queries yet" on top of real data — a silent failure with no
 * error anywhere.
 *
 * The original D1 incarnation of this bug came from binding the divisor as a
 * SQLite REAL, which turned `created_at / ?` into floating-point division so
 * `(x / n) * n` returned `x` and every event landed in its own bucket. Postgres
 * has the same trap through a different door: an untyped bound parameter
 * resolves `bigint / $n` through the numeric operator. `bucketExpr` pins the
 * divisor with `::bigint` to force integer division; these tests pin the JS
 * half of the contract that the SQL must match.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** 2026-07-24T00:00:00Z — a day boundary, for readable expectations. */
const JUL_24 = Date.UTC(2026, 6, 24);

/** The JS-side reference implementation of `bucketExpr`'s integer division. */
function sqlBucket(createdAt: number, bucketMs: number): number {
  return Math.floor(createdAt / bucketMs) * bucketMs;
}

describe("bucketStart", () => {
  it("floors a timestamp to its day boundary", () => {
    expect(bucketStart(JUL_24 + 1, DAY_MS)).toBe(JUL_24);
    expect(bucketStart(JUL_24 + 15 * HOUR_MS, DAY_MS)).toBe(JUL_24);
    expect(bucketStart(JUL_24 + DAY_MS - 1, DAY_MS)).toBe(JUL_24);
    expect(bucketStart(JUL_24 + DAY_MS, DAY_MS)).toBe(JUL_24 + DAY_MS);
  });

  it("floors a timestamp to its hour boundary", () => {
    expect(bucketStart(JUL_24 + 60_000, HOUR_MS)).toBe(JUL_24);
    expect(bucketStart(JUL_24 + HOUR_MS - 1, HOUR_MS)).toBe(JUL_24);
    expect(bucketStart(JUL_24 + HOUR_MS + 60_000, HOUR_MS)).toBe(JUL_24 + HOUR_MS);
  });
});

describe("bucket key agreement", () => {
  it("produces keys the fill loop actually iterates", () => {
    // A range deliberately NOT starting on a boundary — the case where an
    // off-by-one between the two sides would show up.
    const from = JUL_24 + 9 * HOUR_MS;
    const to = from + 5 * DAY_MS;
    const events = [from + HOUR_MS, from + 2 * DAY_MS, to - 1];

    const boundaries = new Set<number>();
    for (
      let b = bucketStart(from, DAY_MS);
      b <= bucketStart(to - 1, DAY_MS);
      b += DAY_MS
    ) {
      boundaries.add(b);
    }

    for (const ts of events) {
      expect(boundaries.has(sqlBucket(ts, DAY_MS))).toBe(true);
    }
  });

  it("groups same-bucket events together and splits across boundaries", () => {
    const sameDay = [JUL_24 + 1, JUL_24 + 15 * HOUR_MS, JUL_24 + DAY_MS - 1];
    const nextDays = [JUL_24 + 3 * DAY_MS + HOUR_MS];

    const keys = sameDay.map((t) => sqlBucket(t, DAY_MS));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(JUL_24);
    expect(sqlBucket(nextDays[0], DAY_MS)).toBe(JUL_24 + 3 * DAY_MS);
  });

  it("integer division — not float — is what makes bucketing work at all", () => {
    // If the divisor were treated as floating point, `(x / n) * n` would return
    // x unchanged and each event would get a unique bucket. This asserts the
    // property the SQL `::bigint` cast exists to guarantee.
    const floatBucket = (t: number, n: number) => (t / n) * n;
    const ts = JUL_24 + 15 * HOUR_MS;
    expect(floatBucket(ts, DAY_MS)).toBe(ts); // the broken behaviour
    expect(sqlBucket(ts, DAY_MS)).toBe(JUL_24); // the correct one
  });
});

describe("pickGranularity", () => {
  it("uses hourly buckets for short ranges and daily for long ones", () => {
    expect(pickGranularity(JUL_24, JUL_24 + DAY_MS)).toBe("hour");
    expect(pickGranularity(JUL_24, JUL_24 + 3 * DAY_MS)).toBe("hour");
    expect(pickGranularity(JUL_24, JUL_24 + 7 * DAY_MS)).toBe("day");
  });

  it("honours an explicit override", () => {
    expect(pickGranularity(JUL_24, JUL_24 + 30 * DAY_MS, "hour")).toBe("hour");
    expect(pickGranularity(JUL_24, JUL_24 + DAY_MS, "day")).toBe("day");
  });
});

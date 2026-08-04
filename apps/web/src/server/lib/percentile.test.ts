import { describe, expect, it } from "vitest";
import { nearestRankIndex, percentile, percentileRankSql } from "./percentile";

describe("nearestRankIndex", () => {
  it("maps the extremes to first and last element", () => {
    expect(nearestRankIndex(10, 0)).toBe(0);
    expect(nearestRankIndex(10, 1)).toBe(9);
  });

  it("rounds to the nearest rank", () => {
    // p50 of 10 values → round(0.5 * 9) = round(4.5) = 5 (Math.round: half up)
    expect(nearestRankIndex(10, 0.5)).toBe(5);
    // p95 of 100 values → round(0.95 * 99) = round(94.05) = 94
    expect(nearestRankIndex(100, 0.95)).toBe(94);
  });

  it("clamps p outside [0,1] and handles empty/singleton", () => {
    expect(nearestRankIndex(5, -1)).toBe(0);
    expect(nearestRankIndex(5, 2)).toBe(4);
    expect(nearestRankIndex(0, 0.5)).toBe(0);
    expect(nearestRankIndex(1, 0.95)).toBe(0);
  });
});

describe("percentile", () => {
  it("returns null for empty input", () => {
    expect(percentile([], 0.95)).toBeNull();
  });

  it("computes p50 and p95 (nearest-rank, unsorted input)", () => {
    const values = [50, 10, 30, 20, 40]; // sorted: 10,20,30,40,50
    expect(percentile(values, 0)).toBe(10);
    expect(percentile(values, 0.5)).toBe(30);
    expect(percentile(values, 1)).toBe(50);
  });

  it("p95 of 1..100 picks the 95th value", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    // index round(0.95*99)=94 → value 95
    expect(percentile(values, 0.95)).toBe(95);
  });

  it("does not mutate the caller's array", () => {
    const values = [3, 1, 2];
    percentile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("percentileRankSql", () => {
  it("emits a 1-based clamped rank expression", () => {
    expect(percentileRankSql("cnt", 0.95)).toBe(
      "LEAST(GREATEST(round((0.95 * (cnt - 1))::numeric), 0), cnt - 1)::int + 1",
    );
  });

  it("casts to numeric — the cast that pins Postgres to JS rounding", () => {
    // REGRESSION GUARD. Postgres has two round() overloads with different
    // tie-breaking: round(numeric) rounds half AWAY FROM ZERO (like
    // Math.round), round(double precision) rounds half to EVEN. Without the
    // cast, `round(4.5)` yields 4 instead of 5 and the p50 of a 10-value
    // window silently shifts by one rank — a wrong number, never an error.
    expect(percentileRankSql("cnt", 0.5)).toContain("::numeric");
  });

  it("agrees with nearestRankIndex for concrete counts (1-based)", () => {
    // Evaluate the SQL formula in JS the way Postgres would (with the numeric
    // round semantics the ::numeric cast guarantees), and compare.
    const evalSql = (cnt: number, p: number) => {
      const clampedP = Math.min(Math.max(p, 0), 1);
      return (
        Math.trunc(
          Math.min(Math.max(Math.round(clampedP * (cnt - 1)), 0), cnt - 1),
        ) + 1
      );
    };
    for (const cnt of [1, 2, 5, 10, 100, 1000]) {
      for (const p of [0, 0.5, 0.9, 0.95, 0.99, 1]) {
        expect(evalSql(cnt, p)).toBe(nearestRankIndex(cnt, p) + 1);
      }
    }
  });
});

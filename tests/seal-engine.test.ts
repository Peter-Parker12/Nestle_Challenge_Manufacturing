import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, HIGH_AT, projectHigh, recommendStop, scoreSeal, type SealInput } from "../lib/engine/seal";

const base: SealInput = {
  ageDays: 90, nominalLifeDays: 180, criticality: 3, runHours: 1200, nominalRunHours: 2800, cipCycles: 40, nominalCipCycles: 75,
  weeksExposed: 13, weeksOverTemp: 0, weeksOverPressure: 0, lastRating: 2, daysSinceInspection: 20, priorSeals: 3, priorFailures: 0, incidents12m: 0, foreignBody30d: false,
};
const worn: SealInput = { ...base, ageDays: 202, runHours: 3300, cipCycles: 90, lastRating: 4, daysSinceInspection: 9, incidents12m: 1, foreignBody30d: true, criticality: 5 };

describe("seal risk engine", () => {
  it("is deterministic", () => { expect(scoreSeal(base)).toEqual(scoreSeal({ ...base })); });
  it("a young, well-inspected seal is Low and a worn one with an incident is High", () => {
    expect(scoreSeal(base).level).toBe("Low");
    expect(scoreSeal(worn).level).toBe("High");
  });
  it("older is never lower, all else equal", () => {
    let prev = -1;
    for (let a = 0; a <= 360; a += 30) { const s = scoreSeal({ ...base, ageDays: a }).score; expect(s).toBeGreaterThanOrEqual(prev); prev = s; }
  });
  it("criticality scales the score", () => {
    expect(scoreSeal({ ...worn, lastRating: 2, foreignBody30d: false, criticality: 5 }).score).toBeGreaterThan(scoreSeal({ ...worn, lastRating: 2, foreignBody30d: false, criticality: 1 }).score);
  });
  it("a weight of 0 removes the factor", () => {
    const s = scoreSeal(worn, { ...DEFAULT_WEIGHTS, age: 0 });
    expect(s.factors.find((f) => f.key === "age")!.points).toBe(0);
  });
  it("missing data is left out and listed, not treated as good or bad", () => {
    const s = scoreSeal({ ...base, runHours: null, lastRating: null, daysSinceInspection: null });
    expect(s.missing).toEqual(expect.arrayContaining(["runtime", "inspection"]));
    expect(s.factors.find((f) => f.key === "runtime")!.points).toBe(0);
    expect(scoreSeal({ ...base, weeksOverTemp: null }).missing).toContain("thermal");
  });
  it("expert floors apply and are reported", () => {
    const f1 = scoreSeal({ ...base, lastRating: 4 });
    expect(f1.score).toBeGreaterThanOrEqual(75); expect(f1.floors.map((x) => x.rule)).toContain("F1");
    const f2 = scoreSeal({ ...base, ageDays: 200, foreignBody30d: true, lastRating: 3 });
    expect(f2.score).toBeGreaterThanOrEqual(85);
    expect(scoreSeal({ ...base, ageDays: 300, lastRating: 1 }).floors.map((x) => x.rule)).toContain("F3");
  });
  it("factor points add up to the score before floors, and never exceed 100", () => {
    const s = scoreSeal({ ...base, ageDays: 150, lastRating: 3 });
    expect(Math.abs(s.factors.reduce((a, f) => a + f.points, 0) - Math.min(100, s.base * s.multiplier))).toBeLessThan(0.6);
    expect(scoreSeal({ ...worn, ageDays: 900 }).score).toBeLessThanOrEqual(100);
  });
  it("all-zero weights give a zero score, not an error", () => {
    const z = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0])) as any;
    expect(scoreSeal({ ...base, lastRating: 2 }, z).score).toBe(0);
  });
  it("projection: already High is 0; a younger seal reaches High later; the date is the first day at or above High", () => {
    const rates = { runPerDay: 15, cipPerDay: 0.4 };
    expect(projectHigh(worn, rates)).toBe(0);
    const d = projectHigh({ ...base, ageDays: 120, lastRating: 3, daysSinceInspection: 30 }, rates);
    expect(d).not.toBeNull();
    const at = (n: number) => scoreSeal({ ...base, ageDays: 120 + n, lastRating: 3, daysSinceInspection: 30 + n, runHours: 1200 + 15 * n, cipCycles: 40 + 0.4 * n, weeksExposed: 13 + Math.floor(n / 7) }).score;
    expect(at(d!)).toBeGreaterThanOrEqual(HIGH_AT); expect(at(d! - 1)).toBeLessThan(HIGH_AT);
    expect(projectHigh({ ...base, ageDays: 10, daysSinceInspection: 2, lastRating: 1, nominalLifeDays: 5000, nominalRunHours: 90000, nominalCipCycles: 3000 }, rates, DEFAULT_WEIGHTS, 30)).toBeNull();
  });
  it("stop recommendation: first window when High, last window before the date otherwise, and says when none fits", () => {
    const stops = [
      { id: "a", start_on: "2026-11-20", end_on: "2026-11-21", kind: "maintenance" }, { id: "b", start_on: "2026-12-20", end_on: "2026-12-21", kind: "maintenance" },
      { id: "c", start_on: "2026-11-25", end_on: "2026-11-25", kind: "CIP" },
    ];
    expect(recommendStop(stops, "2026-11-11", 0).stop!.id).toBe("a");
    expect(recommendStop(stops, "2026-11-11", 60).stop!.id).toBe("b");
    const late = recommendStop(stops, "2026-11-11", 5);
    expect(late.before).toBe(false); expect(late.note).toMatch(/Plan one earlier/);
    expect(recommendStop([], "2026-11-11", 5).stop).toBeNull();
  });
});

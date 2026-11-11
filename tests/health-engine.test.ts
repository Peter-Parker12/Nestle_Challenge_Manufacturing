import { describe, expect, it } from "vitest";
import { H_WEIGHTS, predictStop, scoreStation, slope, type StationInput } from "../lib/engine/health";

const calm: StationInput = { alarms7: 1, usualPerWeek: 1.5, weeklyAlarms: [2, 1, 2, 1, 2, 1], downtimeMin14: 0, defects14: 0, overdueDays: 0, sealScore: 20 };
const bad: StationInput = { alarms7: 18, usualPerWeek: 1.5, weeklyAlarms: [2, 2, 4, 6, 9, 18], downtimeMin14: 90, defects14: 14, overdueDays: 9, sealScore: 88 };

describe("line-health engine", () => {
  it("is deterministic and separates a calm station from a failing one", () => {
    expect(scoreStation(bad)).toEqual(scoreStation({ ...bad }));
    expect(scoreStation(calm).level).toBe("Low");
    expect(scoreStation(bad).level).toBe("High");
  });
  it("more alarms never lowers the score", () => {
    let prev = -1;
    for (let a = 0; a <= 20; a += 2) { const s = scoreStation({ ...calm, alarms7: a }).score; expect(s).toBeGreaterThanOrEqual(prev); prev = s; }
  });
  it("factor points add up to the score", () => {
    const s = scoreStation(bad);
    expect(Math.abs(s.factors.reduce((a, f) => a + f.points, 0) - s.score)).toBeLessThan(0.6);
  });
  it("no tracked seal leaves that factor out instead of scoring it as safe", () => {
    const s = scoreStation({ ...bad, sealScore: null });
    expect(s.factors.find((f) => f.key === "seal")!.missing).toBe(true);
    expect(s.factors.find((f) => f.key === "seal")!.points).toBe(0);
    expect(Object.keys(H_WEIGHTS)).toHaveLength(6);
  });
  it("a station with no history of alarms still scores from the 7-day count", () => {
    expect(scoreStation({ ...calm, usualPerWeek: 0, alarms7: 6 }).score).toBeGreaterThan(scoreStation({ ...calm, usualPerWeek: 0, alarms7: 0 }).score);
  });
  it("slope is exact on a line", () => { expect(slope([1, 2, 3, 4])).toBeCloseTo(1); expect(slope([5, 5, 5])).toBe(0); expect(slope([1])).toBe(0); });
  it("prediction: unknown without earlier stops; at or above; rising with a time; flat says so", () => {
    expect(predictStop([1, 2, 3], null).status).toBe("unknown");
    expect(predictStop([3, 5, 9, 12], 8).status).toBe("at_or_above");
    const r = predictStop([1, 2, 3, 4, 5, 6], 10);
    expect(r.status).toBe("rising"); expect(r.weeks).toBe(4);
    expect(predictStop([2, 2, 3, 2, 2, 2], 10).status).toBe("not_rising");
    expect(predictStop([0, 0, 0, 0, 0, 1], 40).status).toBe("not_rising"); // would take more than 8 weeks
  });
});

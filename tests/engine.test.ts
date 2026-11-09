import { describe, expect, it } from "vitest";
import { citedCodes, invalidCitations, numbersIn, unverifiedNumbers } from "../lib/ai/checks";
import { deriveRunResult } from "../lib/engine/outcome";
import { distance, evalCondition, recommend, similarityFromDistance } from "../lib/engine/recommend";
import type { AttrDef, HistLaunch, ParamDef, RecInput } from "../lib/engine/types";
import { levelValue, normalise, resolveLevels, weightWarnings } from "../lib/engine/weights";

const attrDefs: AttrDef[] = [
  { id: "a1", code: "visc", name: "Viscosity", unit: "cP", type: "numeric", required: true, absMin: 0, absMax: 100 },
  { id: "a2", code: "fat", name: "Fat", unit: "%", type: "numeric", required: true, absMin: 0, absMax: 10 },
  { id: "a3", code: "base", name: "Base", unit: null, type: "choice", choices: ["milk", "plant"], required: true, absMin: null, absMax: null },
];
const paramDefs: ParamDef[] = [
  { id: "p1", code: "homog", name: "Homogenisation", unit: "bar", absMin: 100, absMax: 300, isCritical: true, isLocked: false, stepSeq: 1 },
];

function launch(i: number, visc: number, fat: number, homog: number, over: Partial<HistLaunch> = {}): HistLaunch {
  return { launchId: `id${i}`, code: `L-${1000 + i}`, productName: `P${i}`, lineId: "line1", attrs: { visc, fat, base: "milk" }, acceptedParams: { homog },
    runs: 1, totalLossKg: 50, firstPass: true, reasons: [], ...over };
}

const baseInput = (history: HistLaunch[], extra: Partial<RecInput> = {}): RecInput => ({
  attrDefs, paramDefs, target: { visc: 30, fat: 2, base: "milk" }, lineId: "line1", lineCaps: { homog: { min: 130, max: 280 } },
  history, weights: { attributes: {}, parameters: {} }, rules: [], topN: 5, minMatched: 3, ...extra,
});

describe("weights", () => {
  it("maps the 0-5 scale to uneven internal values", () => {
    expect([0, 1, 2, 3, 4, 5].map(levelValue)).toEqual([0, 1, 2, 3, 5, 8]);
  });
  it("normalises to 1 and falls back to equal weights when all are Ignore", () => {
    const n = normalise({ a: 5, b: 3, c: 0 });
    expect(Object.values(n).reduce((x, y) => x + y, 0)).toBeCloseTo(1);
    expect(n.a).toBeGreaterThan(n.b);
    expect(normalise({ a: 0, b: 0 })).toEqual({ a: 0.5, b: 0.5 });
  });
  it("lets the most specific layer win and reports the source", () => {
    const r = resolveLevels(["a", "b", "c"], { platform: { a: 1 }, category: { a: 2, b: 4 }, recipe: { a: 5 } });
    expect(r.levels).toEqual({ a: 5, b: 4, c: 3 });
    expect(r.source).toEqual({ a: "recipe", b: "category", c: "default" });
  });
  it("warns on too many Critical items and a thin match pool (BR-08)", () => {
    const w = weightWarnings({ attributes: { a: 5, b: 5, c: 5 }, parameters: {} }, 2, 3);
    expect(w).toHaveLength(2);
    expect(weightWarnings({ attributes: { a: 5 }, parameters: {} }, 5, 3)).toHaveLength(0);
  });
});

describe("run outcome (BR-13)", () => {
  const q = (value: number, critical = true) => ({ code: "x", value, specMin: 10, specMax: 20, critical });
  it("passes when everything is comfortably inside spec", () => expect(deriveRunResult({ quality: [q(15)], params: [] }).result).toBe("Pass"));
  it("fails on a critical test out of spec", () => expect(deriveRunResult({ quality: [q(25)], params: [] }).result).toBe("Fail"));
  it("is marginal on a non-critical miss", () => expect(deriveRunResult({ quality: [q(25, false)], params: [] }).result).toBe("Marginal"));
  it("is marginal when a critical test is within 5% of its limit", () => expect(deriveRunResult({ quality: [q(10.2)], params: [] }).result).toBe("Marginal"));
  it("is marginal when a setting leaves line capability", () =>
    expect(deriveRunResult({ quality: [q(15)], params: [{ code: "p", actual: 500, capMin: 100, capMax: 300 }] }).result).toBe("Marginal"));
  it("fails an aborted run", () => expect(deriveRunResult({ aborted: true, quality: [], params: [] }).result).toBe("Fail"));
});

describe("similarity", () => {
  const ranges = { visc: 40, fat: 3 };
  const w = { visc: 0.5, fat: 0.3, base: 0.2 };
  it("is 0 distance and similarity 1 for identical products", () => {
    const d = distance({ visc: 30, fat: 2, base: "milk" }, { visc: 30, fat: 2, base: "milk" }, attrDefs, w, ranges);
    expect(d).toBe(0);
    expect(similarityFromDistance(d)).toBe(1);
  });
  it("penalises a different choice attribute", () => {
    const same = distance({ visc: 30, fat: 2, base: "milk" }, { visc: 30, fat: 2, base: "milk" }, attrDefs, w, ranges);
    const diff = distance({ visc: 30, fat: 2, base: "milk" }, { visc: 30, fat: 2, base: "plant" }, attrDefs, w, ranges);
    expect(diff).toBeGreaterThan(same);
  });
  it("counts heavier-weighted attributes more", () => {
    const t = { visc: 30, fat: 2, base: "milk" };
    const c = { visc: 10, fat: 2, base: "milk" };
    const heavy = distance(t, c, attrDefs, { visc: 0.8, fat: 0.1, base: 0.1 }, ranges);
    const light = distance(t, c, attrDefs, { visc: 0.1, fat: 0.8, base: 0.1 }, ranges);
    expect(heavy).toBeGreaterThan(light);
  });
});

describe("recommend", () => {
  const history = [
    launch(1, 30, 2, 200), launch(2, 28, 2.1, 196), launch(3, 32, 1.9, 205), launch(4, 31, 2.2, 202),
    launch(5, 12, 0.8, 140), launch(6, 45, 3.2, 260),
  ];

  it("builds a window around the nearest launches", () => {
    const r = recommend(baseInput(history));
    const line = r.lines[0];
    expect(line.startValue).toBeGreaterThan(190);
    expect(line.startValue).toBeLessThan(210);
    expect(line.windowLow).toBeLessThanOrEqual(line.startValue);
    expect(line.windowHigh).toBeGreaterThanOrEqual(line.startValue);
    expect(r.neighbours[0].rank).toBe(1);
    expect(r.neighbours.length).toBeLessThanOrEqual(5);
  });

  it("is deterministic (BR-09)", () => {
    expect(JSON.stringify(recommend(baseInput(history)))).toBe(JSON.stringify(recommend(baseInput(history))));
  });

  it("clips values to line capability and flags it (BR-02)", () => {
    const r = recommend(baseInput(history, { lineCaps: { homog: { min: 130, max: 150 } } }));
    const line = r.lines[0];
    expect(line.windowHigh).toBeLessThanOrEqual(150);
    expect(line.clipped).toBe(true);
    expect(r.flags.some((f) => f.type === "clipped")).toBe(true);
  });

  it("gives Low confidence and a High low_evidence flag with too few matches (BR-04)", () => {
    const r = recommend(baseInput(history.slice(0, 2)));
    expect(r.confidence).toBe("Low");
    expect(r.flags.find((f) => f.type === "low_evidence")?.severity).toBe("High");
    expect(r.overallRisk).toBe("High");
  });

  it("falls back to the line capability midpoint with no history", () => {
    const r = recommend(baseInput([]));
    expect(r.confidence).toBe("Low");
    expect(r.lines[0].startValue).toBeCloseTo(205, 0);
  });

  it("flags a target outside anything seen in history", () => {
    const r = recommend(baseInput(history, { target: { visc: 90, fat: 2, base: "milk" } }));
    expect(r.flags.some((f) => f.type === "out_of_range" && f.severity === "High")).toBe(true);
  });

  it("flags rework history with the common reasons", () => {
    const reworked = history.map((h, i) => (i < 4 ? { ...h, runs: 3, firstPass: false, reasons: ["sedimentation"] } : h));
    const f = recommend(baseInput(reworked)).flags.find((x) => x.type === "rework_history");
    expect(f).toBeTruthy();
    expect(f!.message).toContain("sedimentation");
  });

  it("fires SME rules (and only when the condition holds)", () => {
    const rule = { id: "r1", condition: { attr: "fat", op: ">" as const, value: 2.5 }, severity: "Medium" as const, message: "High fat" };
    expect(recommend(baseInput(history, { rules: [rule] })).flags.some((f) => f.type === "sme_rule")).toBe(false);
    expect(recommend(baseInput(history, { rules: [rule], target: { visc: 30, fat: 3, base: "milk" } })).flags.some((f) => f.type === "sme_rule")).toBe(true);
  });

  it("makes critical parameters tighter than minor ones", () => {
    const spread = [launch(1, 30, 2, 180), launch(2, 30, 2, 200), launch(3, 30, 2, 220), launch(4, 30, 2, 200)];
    const tight = recommend(baseInput(spread, { weights: { attributes: {}, parameters: { homog: 5 } } })).lines[0];
    const loose = recommend(baseInput(spread, { weights: { attributes: {}, parameters: { homog: 0 } } })).lines[0];
    expect(tight.windowHigh - tight.windowLow).toBeLessThan(loose.windowHigh - loose.windowLow);
  });

  it("changes the neighbours when an engineer reweights attributes (BR-11)", () => {
    const h = [launch(1, 30, 3.5, 200), launch(2, 12, 2, 150), launch(3, 31, 3.4, 205), launch(4, 11, 2.1, 148)];
    const byVisc = recommend(baseInput(h, { topN: 2, minMatched: 1, weights: { attributes: { visc: 5, fat: 0, base: 0 }, parameters: {} }, target: { visc: 30, fat: 2, base: "milk" } }));
    const byFat = recommend(baseInput(h, { topN: 2, minMatched: 1, weights: { attributes: { visc: 0, fat: 5, base: 0 }, parameters: {} }, target: { visc: 30, fat: 2, base: "milk" } }));
    expect(byVisc.neighbours.map((n) => n.code).sort()).not.toEqual(byFat.neighbours.map((n) => n.code).sort());
  });
});

describe("rule conditions", () => {
  it("supports compound conditions", () => {
    const c = { all: [{ attr: "fat", op: ">" as const, value: 2 }, { attr: "visc", op: "<=" as const, value: 40 }] };
    expect(evalCondition(c, { fat: 3, visc: 40 })).toBe(true);
    expect(evalCondition(c, { fat: 3, visc: 41 })).toBe(false);
    expect(evalCondition(c, { visc: 10 })).toBe(false);
  });
});

describe("AI output checks", () => {
  it("finds numbers in the AI text that are not in the data", () => {
    const known = numbersIn({ start: 204.5, window: [190, 215], n: 5 });
    expect(unverifiedNumbers("Start near 204.5 bar, window 190 to 215.", known)).toEqual([]);
    expect(unverifiedNumbers("Start near 250 bar.", known)).toEqual(["250"]);
  });
  it("ignores small whole numbers", () => expect(unverifiedNumbers("3 of 7 launches", new Set())).toEqual([]));
  it("extracts and validates citations", () => {
    const cited = citedCodes("See [L-1003] and L-1004, also L-9999.");
    expect(cited).toEqual(["L-1003", "L-1004", "L-9999"]);
    expect(invalidCitations(cited, new Set(["L-1003", "L-1004"]))).toEqual(["L-9999"]);
  });
});

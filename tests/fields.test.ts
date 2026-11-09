import { describe, expect, it } from "vitest";
import { distanceWithCoverage, recommend } from "../lib/engine/recommend";
import type { AttrDef, HistLaunch, ParamDef, RecInput } from "../lib/engine/types";
import { parseFieldValue } from "../lib/fieldValues";
import { validateFieldInput } from "../lib/fields";

const def = (o: Partial<AttrDef> & { code: string; type: AttrDef["type"] }): AttrDef => ({
  id: o.code, name: o.code, unit: null, required: false, absMin: null, absMax: null, kind: "matching", status: "Active", aiVisible: true, ...o,
});
const visc = def({ code: "visc", type: "numeric", absMin: 0, absMax: 100 });
const fat = def({ code: "fat", type: "numeric", absMin: 0, absMax: 10 });
const organic = def({ code: "organic", type: "boolean" });
const notes = def({ code: "notes", type: "text", kind: "info" });
const paramDefs: ParamDef[] = [{ id: "p1", code: "homog", name: "Homog", unit: "bar", absMin: 100, absMax: 300, isCritical: true, isLocked: false, stepSeq: 1 }];

const L = (i: number, attrs: HistLaunch["attrs"], homog = 200): HistLaunch => ({
  launchId: `id${i}`, code: `L-${1000 + i}`, productName: `P${i}`, lineId: "l1", attrs, acceptedParams: { homog }, runs: 1, totalLossKg: 1, firstPass: true, reasons: [],
});
const input = (history: HistLaunch[], attrDefs: AttrDef[], target: HistLaunch["attrs"], extra: Partial<RecInput> = {}): RecInput => ({
  attrDefs, paramDefs, target, lineId: "l1", lineCaps: { homog: { min: 130, max: 280 } }, history, weights: { attributes: {}, parameters: {} }, rules: [], topN: 5, minMatched: 3, ...extra,
});

describe("missing values never make a launch look closer", () => {
  const w = { visc: 0.5, fat: 0.5 };
  const ranges = { visc: 40, fat: 3 };
  it("compares only fields both products have, and reports the coverage", () => {
    const full = distanceWithCoverage({ visc: 30, fat: 2 }, { visc: 10, fat: 2 }, [visc, fat], w, ranges);
    const partial = distanceWithCoverage({ visc: 30, fat: 2 }, { visc: 10 }, [visc, fat], w, ranges);
    expect(full.coverage).toBe(1);
    expect(partial.coverage).toBe(0.5);
    expect(partial.d).toBeGreaterThanOrEqual(full.d); // the old code made a missing value look closer, never further
  });
  it("no shared fields means maximum distance", () => expect(distanceWithCoverage({ visc: 30 }, { fat: 2 }, [visc, fat], w, ranges)).toEqual({ d: 1, coverage: 0 }));
  it("a launch with a missing value ranks below an equally close one that has it", () => {
    const hist = [L(1, { visc: 30, fat: 2 }), L(2, { visc: 30 }), L(3, { visc: 31, fat: 2.1 }), L(4, { visc: 29, fat: 1.9 })];
    const r = recommend(input(hist, [visc, fat], { visc: 30, fat: 2 }));
    const rank = (c: string) => r.neighbours.find((n) => n.code === c)!.rank;
    expect(rank("L-1002")).toBeGreaterThan(rank("L-1001"));
    expect(r.neighbours.find((n) => n.code === "L-1002")!.coverage).toBeLessThan(1);
  });
});

describe("custom fields in the engine", () => {
  const base = [1, 2, 3, 4, 5].map((i) => L(i, { visc: 20 + i, fat: 2, organic: i % 2 === 0 }, 190 + i));
  it("uses a boolean field for matching", () => {
    const a = recommend(input(base, [visc, fat, organic], { visc: 22, fat: 2, organic: true }, { weights: { attributes: { visc: 0, fat: 0, organic: 5 }, parameters: {} } }));
    expect(a.neighbours.slice(0, 2).every((n) => base.find((b) => b.code === n.code)!.attrs.organic === true)).toBe(true);
  });
  it("never uses information fields for matching", () => {
    const withNotes = base.map((b, i) => ({ ...b, attrs: { ...b.attrs, notes: `note ${i}` } }));
    const a = recommend(input(base, [visc, fat], { visc: 22, fat: 2 }));
    const b = recommend(input(withNotes, [visc, fat, notes], { visc: 22, fat: 2, notes: "something else" }));
    expect(b.neighbours.map((n) => n.code)).toEqual(a.neighbours.map((n) => n.code));
    expect(Object.keys(b.normalisedWeights.attributes)).not.toContain("notes");
  });
  it("ignores a matching field that too little of the history has, and says so", () => {
    const sparse = [1, 2, 3, 4, 5].map((i) => L(i, i === 1 ? { visc: 21, fat: 2, organic: true } : { visc: 20 + i, fat: 2 }, 190 + i));
    const r = recommend(input(sparse, [visc, fat, organic], { visc: 22, fat: 2, organic: true }));
    expect(r.ignoredFields.map((f) => f.code)).toEqual(["organic"]);
    expect(r.flags.some((f) => f.type === "missing_data" && /not used for matching yet/.test(f.message))).toBe(true);
    expect(Object.keys(r.normalisedWeights.attributes)).not.toContain("organic");
  });
  it("uses the same sparse field once enough of the history has values", () => {
    const r = recommend(input(base, [visc, fat, organic], { visc: 22, fat: 2, organic: true }));
    expect(r.ignoredFields).toEqual([]);
  });
  it("skips Draft and Retired fields", () => {
    const r = recommend(input(base, [visc, fat, { ...organic, status: "Retired" }], { visc: 22, fat: 2, organic: true }));
    expect(Object.keys(r.normalisedWeights.attributes)).toEqual(["visc", "fat"]);
  });
  it("warns when the target has no value for a weighted field", () => {
    const r = recommend(input(base, [visc, fat, organic], { visc: 22, fat: 2 }, { weights: { attributes: { organic: 4 }, parameters: {} } }));
    expect(r.flags.some((f) => f.type === "missing_data" && /no value for organic/.test(f.message))).toBe(true);
  });
  it("lowers confidence when the matches rest on few fields", () => {
    const thin = [1, 2, 3, 4, 5, 6].map((i) => L(i, { visc: 20 + i }));
    const r = recommend(input(thin, [visc, fat], { visc: 22, fat: 2 }, { minFieldCoverage: 0 }));
    expect(r.meanCoverage).toBeLessThan(0.7);
    expect(r.confidence).not.toBe("High");
    expect(r.flags.some((f) => f.type === "missing_data" && /fewer product fields/.test(f.message))).toBe(true);
  });
});

describe("field values", () => {
  it("parses booleans in several spellings", () => {
    for (const t of ["yes", "TRUE", "1", "y"]) expect(parseFieldValue(organic, t)).toEqual({ ok: true, value: true });
    for (const t of ["no", "False", "0"]) expect(parseFieldValue(organic, t)).toEqual({ ok: true, value: false });
    expect(parseFieldValue(organic, "maybe").ok).toBe(false);
  });
  it("validates dates, text length, numbers and choices", () => {
    const date = def({ code: "d", type: "date" });
    expect(parseFieldValue(date, "2025-02-31").ok).toBe(false);
    expect(parseFieldValue(date, "2025-02-28").ok).toBe(true);
    expect(parseFieldValue(notes, "x".repeat(501)).ok).toBe(false);
    expect(parseFieldValue(visc, "150").ok).toBe(false);
    expect(parseFieldValue(visc, "30,5")).toEqual({ ok: true, value: 30.5 });
    expect(parseFieldValue(def({ code: "c", type: "choice", choices: ["a", "b"] }), "z").ok).toBe(false);
  });
});

describe("field definition rules", () => {
  const ok = { code: "pack_type", name: "Pack type", type: "choice" as const, choices: ["carton", "pouch"] };
  it("accepts a valid choice field and defaults to weight 0", () => {
    const r = validateFieldInput(ok);
    expect(r.errors).toEqual([]);
    expect(r.clean.initialWeight).toBe(0);
    expect(r.clean.kind).toBe("matching");
  });
  it("forces text and date fields to information only, and text to not AI visible by default", () => {
    const t = validateFieldInput({ code: "remarks", name: "Remarks", type: "text", kind: "matching" });
    expect(t.clean.kind).toBe("info");
    expect(t.clean.aiVisible).toBe(false);
    expect(validateFieldInput({ code: "launch_on", name: "Launch date", type: "date" }).clean.kind).toBe("info");
  });
  it("rejects bad codes, reserved codes and bad choices or ranges", () => {
    expect(validateFieldInput({ ...ok, code: "Pack Type" }).errors.length).toBeGreaterThan(0);
    expect(validateFieldInput({ ...ok, code: "line" }).errors.join()).toMatch(/reserved/);
    expect(validateFieldInput({ ...ok, choices: ["only"] }).errors.join()).toMatch(/at least two/);
    expect(validateFieldInput({ code: "brix", name: "Brix", type: "numeric", absMin: 5, absMax: 5 }).errors.join()).toMatch(/below the maximum/);
    expect(validateFieldInput({ code: "brix", name: "Brix", type: "numeric" }).errors.join()).toMatch(/minimum and a maximum/);
    expect(validateFieldInput({ ...ok, initialWeight: 9 }).errors.join()).toMatch(/0 to 5/);
  });
});

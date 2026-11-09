import { describe, expect, it } from "vitest";
import { validateParameterInput, validateTestInput } from "../lib/process";

const ok = { stepId: "s", code: "pump_speed_rpm", name: "Pump speed", unit: "rpm", absMin: 500, absMax: 3000 };

describe("parameter rules", () => {
  it("accepts a valid parameter", () => expect(validateParameterInput(ok)).toEqual([]));
  it("needs a unit, a sensible code and a name", () => {
    expect(validateParameterInput({ ...ok, unit: "" }).join()).toMatch(/unit is required/);
    expect(validateParameterInput({ ...ok, code: "Pump Speed" }).join()).toMatch(/Code must/);
    expect(validateParameterInput({ ...ok, name: "x" }).join()).toMatch(/Name must/);
    expect(validateParameterInput({ ...ok, unit: "x".repeat(13) }).join()).toMatch(/unit is required/);
  });
  it("needs a range with the lowest below the highest", () => {
    expect(validateParameterInput({ ...ok, absMin: 5, absMax: 5 }).join()).toMatch(/lowest value must be below/);
    expect(validateParameterInput({ ...ok, absMin: NaN }).join()).toMatch(/Enter the lowest/);
  });
});

describe("quality test rules", () => {
  it("accepts a valid test", () => expect(validateTestInput({ code: "color_l", name: "Colour (L*)" })).toEqual([]));
  it("rejects bad codes, names and units", () => {
    expect(validateTestInput({ code: "1bad", name: "Colour" }).length).toBeGreaterThan(0);
    expect(validateTestInput({ code: "ok_code", name: "" }).join()).toMatch(/Name must/);
    expect(validateTestInput({ code: "ok_code", name: "Colour", unit: "x".repeat(13) }).join()).toMatch(/Unit is at most/);
  });
});

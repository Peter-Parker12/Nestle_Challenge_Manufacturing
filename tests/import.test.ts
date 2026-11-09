import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../lib/csv";
import { buildTemplate, parseHistory, type ImportConfig } from "../lib/importer";

const cfg: ImportConfig = {
  attrDefs: [
    { id: "a1", code: "visc", name: "Viscosity", unit: "cP", type: "numeric", required: true, absMin: 5, absMax: 60 },
    { id: "a2", code: "base", name: "Base", unit: null, type: "choice", choices: ["milk", "plant"], required: true, absMin: null, absMax: null },
  ],
  paramDefs: [{ id: "p1", code: "homog", name: "Homogenisation", unit: "bar", absMin: 100, absMax: 320, isCritical: true, isLocked: false, stepSeq: 1 }],
  tests: [{ code: "sed", name: "Sediment", unit: "%", is_critical: true }],
  lineCodes: new Set(["L1", "L2"]),
  reasonCodes: new Set(["sedimentation", "viscosity_off"]),
  existingProductCodes: new Set(["OLD-1"]),
};
const opt = { assumeAccepted: false };
const H = "launch_ref,product_name,line,created_date,run_no,run_date,result,loss_kg,reason_codes,ta_decision,ta_date,attr_visc,attr_base,param_homog,q_sed,spec_sed_min,spec_sed_max";
const csv = (...rows: string[]) => [H, ...rows].join("\n");
const errs = (r: ReturnType<typeof parseHistory>) => r.issues.filter((i) => i.level === "error");
const warns = (r: ReturnType<typeof parseHistory>) => r.issues.filter((i) => i.level === "warning");

describe("csv", () => {
  it("handles quotes, commas, newlines, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n"line1\nline2",z\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["line1\nline2", "z"]]);
  });
  it("round-trips through toCsv", () => {
    const rows = [["a", "b,c", 'd"e'], ["1", "", "line\nbreak"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it("rejects an unclosed quote", () => expect(() => parseCsv('a,"b')).toThrow(/quote/));
  it("ignores blank lines", () => expect(parseCsv("a,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]));
});

describe("template", () => {
  it("imports cleanly without edits", () => {
    const r = parseHistory(buildTemplate(cfg, "L1"), cfg, opt);
    expect(errs(r)).toEqual([]);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].runs).toHaveLength(2);
    expect(r.launches[0].taDecision).toBe("Accepted");
  });
});

describe("a good file", () => {
  const good = csv(
    "H1,Prod A,L1,2025-01-10,1,2025-01-15,,240,sedimentation,,,30,milk,180,0.7,,0.5",
    "H1,Prod A,L1,2025-01-10,2,2025-01-25,,60,,Accepted,2025-02-01,30,milk,215,0.3,,0.5",
  );
  it("groups runs into a launch and calculates results from quality and spec", () => {
    const r = parseHistory(good, cfg, opt);
    expect(errs(r)).toEqual([]);
    const l = r.launches[0];
    expect(l.runs.map((x) => x.result)).toEqual(["Fail", "Pass"]);
    expect(l.taDecision).toBe("Accepted");
    expect(l.specs.sed).toEqual({ min: null, max: 0.5 });
    expect(l.attrs).toEqual({ visc: 30, base: "milk" });
  });
  it("accepts decimal commas in quoted cells", () => {
    const r = parseHistory(csv('H1,P,L1,2025-01-10,1,,Pass,,,Accepted,,"30,5",milk,180,,,'), cfg, opt);
    expect(errs(r)).toEqual([]);
    expect(r.launches[0].attrs.visc).toBe(30.5);
  });
});

describe("problems are reported with the file row number", () => {
  const one = (row: string, o = opt) => parseHistory(csv(row), cfg, o);
  it("unknown line", () => { const e = errs(one("H1,P,L9,2025-01-10,1,,Pass,,,Accepted,,30,milk,180,,,")); expect(e[0].row).toBe(2); expect(e[0].message).toMatch(/Unknown line/); });
  it("bad date", () => expect(errs(one("H1,P,L1,10/01/2025,1,,Pass,,,Accepted,,30,milk,180,,,"))[0].message).toMatch(/YYYY-MM-DD/));
  it("impossible date", () => expect(errs(one("H1,P,L1,2025-02-31,1,,Pass,,,Accepted,,30,milk,180,,,"))[0].field).toBe("created_date"));
  it("setting out of range", () => expect(errs(one("H1,P,L1,2025-01-10,1,,Pass,,,Accepted,,30,milk,999,,,"))[0].message).toMatch(/outside the allowed range/));
  it("attribute out of range and wrong choice", () => {
    const e = errs(one("H1,P,L1,2025-01-10,1,,Pass,,,Accepted,,99,cheese,180,,,"));
    expect(e.map((x) => x.field)).toEqual(["attr_visc", "attr_base"]);
  });
  it("missing required attribute", () => expect(errs(one("H1,P,L1,2025-01-10,1,,Pass,,,Accepted,,,milk,180,,,"))[0].message).toMatch(/required/));
  it("not a number", () => expect(errs(one("H1,P,L1,2025-01-10,1,,Pass,abc,,Accepted,,30,milk,180,,,"))[0].field).toBe("loss_kg"));
  it("unknown reason code", () => expect(errs(one("H1,P,L1,2025-01-10,1,,Fail,,nonsense,Rejected,,30,milk,180,,,"))[0].message).toMatch(/Unknown reason/));
  it("empty launch_ref", () => expect(errs(one(",P,L1,2025-01-10,1,,Pass,,,Accepted,,30,milk,180,,,"))[0].field).toBe("launch_ref"));
  it("a product that already exists", () => expect(errs(one("OLD-1,P,L1,2025-01-10,1,,Pass,,,Accepted,,30,milk,180,,,"))[0].message).toMatch(/already exists/));
  it("no result and nothing to calculate it from", () => expect(errs(one("H1,P,L1,2025-01-10,1,,,,,Accepted,,30,milk,180,,,"))[0].message).toMatch(/No result given/));
  it("min above max in a spec", () => expect(errs(one("H1,P,L1,2025-01-10,1,,Pass,,,Accepted,,30,milk,180,0.3,0.9,0.1"))[0].message).toMatch(/min .* above max/));
});

describe("run sequence and outcomes", () => {
  it("duplicate run numbers", () => {
    const r = parseHistory(csv("H1,P,L1,2025-01-10,1,,Fail,,sedimentation,,,30,milk,180,,,", "H1,P,L1,2025-01-10,1,,Pass,,,Accepted,,30,milk,180,,,"), cfg, opt);
    expect(errs(r).some((e) => /appears twice/.test(e.message))).toBe(true);
  });
  it("gaps in numbering", () => {
    const r = parseHistory(csv("H1,P,L1,2025-01-10,1,,Fail,,sedimentation,,,30,milk,180,,,", "H1,P,L1,2025-01-10,3,,Pass,,,Accepted,,30,milk,180,,,"), cfg, opt);
    expect(errs(r).some((e) => /without gaps/.test(e.message))).toBe(true);
  });
  it("rows out of order are sorted by run_no", () => {
    const r = parseHistory(csv("H1,P,L1,2025-01-10,2,,Pass,,,Accepted,,30,milk,200,,,", "H1,P,L1,2025-01-10,1,,Fail,,sedimentation,,,30,milk,180,,,"), cfg, opt);
    expect(errs(r)).toEqual([]);
    expect(r.launches[0].runs.map((x) => x.runNo)).toEqual([1, 2]);
  });
  it("a failed run followed by another needs a reason code (BR-14)", () => {
    const r = parseHistory(csv("H1,P,L1,2025-01-10,1,,Fail,,,,,30,milk,180,,,", "H1,P,L1,2025-01-10,2,,Pass,,,Accepted,,30,milk,200,,,"), cfg, opt);
    expect(errs(r)[0].message).toMatch(/reason code/);
  });
  it("last run passed with no acceptance: error by default, Accepted with a warning when the option is on", () => {
    const row = "H1,P,L1,2025-01-10,1,,Pass,,,,,30,milk,180,,,";
    expect(errs(parseHistory(csv(row), cfg, { assumeAccepted: false }))[0].field).toBe("ta_decision");
    const r = parseHistory(csv(row), cfg, { assumeAccepted: true });
    expect(errs(r)).toEqual([]);
    expect(r.launches[0].taDecision).toBe("Accepted");
    expect(warns(r).some((w) => /Treated as Accepted/.test(w.message))).toBe(true);
  });
  it("a launch that never passed and has no decision is imported as cancelled", () => {
    const r = parseHistory(csv("H1,P,L1,2025-01-10,1,,Fail,,sedimentation,,,30,milk,180,,,"), cfg, opt);
    expect(errs(r)).toEqual([]);
    expect(r.launches[0].status).toBe("Cancelled");
    expect(r.launches[0].taDecision).toBeNull();
  });
  it("cannot be Accepted when the last run failed", () => {
    expect(errs(parseHistory(csv("H1,P,L1,2025-01-10,1,,Fail,,sedimentation,Accepted,,30,milk,180,,,"), cfg, opt))[0].message).toMatch(/cannot be Accepted/);
  });
  it("calculates the result from quality results and ignores an over-optimistic file value", () => {
    const r = parseHistory(csv("H1,P,L1,2025-01-10,1,,Pass,,sedimentation,Rejected,,30,milk,180,0.9,,0.5"), cfg, opt);
    expect(r.launches[0].runs[0].result).toBe("Fail");
    expect(warns(r).some((w) => /calculated result is used/.test(w.message))).toBe(true);
  });
  it("keeps a more severe file result than the quality data shows", () => {
    const r = parseHistory(csv("H1,P,L1,2025-01-10,1,,Marginal,,sedimentation,,,30,milk,180,0.2,,0.5", "H1,P,L1,2025-01-10,2,,Pass,,,Accepted,,30,milk,200,0.2,,0.5"), cfg, opt);
    expect(errs(r)).toEqual([]);
    expect(r.launches[0].runs[0].result).toBe("Marginal");
    expect(warns(r).some((w) => /more severe file result is kept/.test(w.message))).toBe(true);
  });
});

describe("file level problems", () => {
  it("missing required column", () => expect(errs(parseHistory("launch_ref,product_name\nH1,P", cfg, opt)).some((e) => /Missing required column "line"/.test(e.message))).toBe(true));
  it("header only", () => expect(errs(parseHistory(H, cfg, opt))[0].message).toMatch(/no data rows/));
  it("unrecognised columns are ignored with a warning", () => {
    const r = parseHistory(H + ",extra\nH1,P,L1,2025-01-10,1,,Pass,,,Accepted,,30,milk,180,,,,zzz", cfg, opt);
    expect(errs(r)).toEqual([]);
    expect(warns(r).some((w) => /not recognised/.test(w.message))).toBe(true);
  });
  it("an invalid launch does not stop valid ones", () => {
    const r = parseHistory(csv("H1,P,L1,2025-01-10,1,,Pass,,,Accepted,,30,milk,180,,,", "H2,P,L9,2025-01-10,1,,Pass,,,Accepted,,30,milk,180,,,"), cfg, opt);
    expect(r.launches.map((l) => l.valid)).toEqual([true, false]);
  });
  it("flags later rows that disagree with the first row of a launch", () => {
    const r = parseHistory(csv("H1,P,L1,2025-01-10,1,,Fail,,sedimentation,,,30,milk,180,,,", "H1,P,L2,2025-01-10,2,,Pass,,,Accepted,,40,milk,200,,,"), cfg, opt);
    expect(warns(r).length).toBe(2);
    expect(r.launches[0].lineCode).toBe("L1");
  });
});

import { deriveRunResult, type QualityIn, type RunResult } from "./engine/outcome";
import type { AttrDef, ParamDef } from "./engine/types";
import { parseCsv, toCsv } from "./csv";
import { isEmpty, parseFieldValue, type FieldValue } from "./fieldValues";

/**
 * Historical launch import.
 * One CSV row = one trial run. Rows are grouped into launches by `launch_ref`.
 * Product-level fields (name, line, dates, attributes, specs) are read from the first row of each launch.
 * Columns are generated per category, see buildTemplate().
 */
export const MAX_ROWS = 5000;
export const MAX_BYTES = 5 * 1024 * 1024;

export type TestDef = { code: string; name: string; unit: string | null; is_critical: boolean };

export type ImportConfig = {
  attrDefs: AttrDef[];
  paramDefs: ParamDef[];
  tests: TestDef[];
  lineCodes: Set<string>;
  reasonCodes: Set<string>;
  existingProductCodes: Set<string>;
};
export type ImportOptions = { assumeAccepted: boolean };

export type Issue = { row: number | null; launch: string | null; field: string | null; message: string; level: "error" | "warning" };

export type ParsedRun = {
  runNo: number;
  date: string;
  params: Record<string, number>;
  quality: Record<string, number>;
  given: RunResult | null;
  result: RunResult;
  resultNotes: string[];
  lossKg: number | null;
  reasons: string[];
  notes: string | null;
  rows: number[];
};
export type ParsedLaunch = {
  ref: string;
  productName: string;
  lineCode: string;
  createdDate: string;
  attrs: Record<string, FieldValue>;
  specs: Record<string, { min: number | null; max: number | null }>;
  runs: ParsedRun[];
  taDecision: "Accepted" | "Accepted with conditions" | "Rejected" | null;
  taDate: string | null;
  status: "Closed" | "Cancelled";
  cancelReason: string | null;
  rows: number[];
  valid: boolean;
};

const FIXED = ["launch_ref", "product_name", "line", "created_date", "run_no", "run_date", "result", "loss_kg", "reason_codes", "notes", "ta_decision", "ta_date"];
const REQUIRED_FIXED = ["launch_ref", "product_name", "line", "run_no"];

export function templateColumns(cfg: Pick<ImportConfig, "attrDefs" | "paramDefs" | "tests">): string[] {
  return [
    ...FIXED,
    ...cfg.attrDefs.map((a) => `attr_${a.code}`),
    ...cfg.paramDefs.map((p) => `param_${p.code}`),
    ...cfg.tests.map((t) => `q_${t.code}`),
    ...cfg.tests.flatMap((t) => [`spec_${t.code}_min`, `spec_${t.code}_max`]),
  ];
}

export function buildTemplate(cfg: Pick<ImportConfig, "attrDefs" | "paramDefs" | "tests">, lineCode: string): string {
  const cols = templateColumns(cfg);
  const example = (ref: string, runNo: number, last: boolean): (string | number)[] => {
    const v: Record<string, string | number> = {
      launch_ref: ref, product_name: "Example product (replace)", line: lineCode, created_date: "2025-03-01", run_no: runNo, run_date: `2025-03-${String(runNo * 5).padStart(2, "0")}`,
      result: last ? "Pass" : "Fail", loss_kg: last ? 80 : 240, reason_codes: last ? "" : "sedimentation", notes: last ? "Stable" : "Sediment high", ta_decision: last ? "Accepted" : "", ta_date: last ? "2025-03-20" : "",
    };
    for (const a of cfg.attrDefs)
      v[`attr_${a.code}`] = a.type === "numeric" ? Math.round(((a.absMin ?? 0) + (a.absMax ?? 10)) / 2) : a.type === "choice" ? a.choices?.[0] ?? "" : a.type === "boolean" ? "yes" : a.type === "date" ? "2025-01-01" : "";
    for (const p of cfg.paramDefs) v[`param_${p.code}`] = Math.round(((p.absMin + p.absMax) / 2) * 10) / 10;
    for (const t of cfg.tests) { v[`q_${t.code}`] = ""; v[`spec_${t.code}_min`] = ""; v[`spec_${t.code}_max`] = ""; }
    return cols.map((c) => v[c] ?? "");
  };
  return toCsv([cols, example("EX-1", 1, false), example("EX-1", 2, true)]);
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

export type ParseResult = {
  launches: ParsedLaunch[];
  issues: Issue[];
  rows: number;
  /** each data row as {header: value}, for storing in the staging table */
  rawRows: Record<string, string>[];
  rowLaunch: (string | null)[];
};

export function parseHistory(csvText: string, cfg: ImportConfig, opt: ImportOptions): ParseResult {
  const issues: Issue[] = [];
  const err = (row: number | null, launch: string | null, field: string | null, message: string) => issues.push({ row, launch, field, message, level: "error" });
  const warn = (row: number | null, launch: string | null, field: string | null, message: string) => issues.push({ row, launch, field, message, level: "warning" });

  let table: string[][];
  try { table = parseCsv(csvText); } catch (e: any) { err(null, null, null, e.message); return { launches: [], issues, rows: 0, rawRows: [], rowLaunch: [] }; }
  if (table.length < 2) { err(null, null, null, "The file has no data rows. It needs a header row and at least one run."); return { launches: [], issues, rows: 0, rawRows: [], rowLaunch: [] }; }
  if (table.length - 1 > MAX_ROWS) { err(null, null, null, `The file has ${table.length - 1} rows; the limit is ${MAX_ROWS}. Split it into several files.`); return { launches: [], issues, rows: 0, rawRows: [], rowLaunch: [] }; }

  const header = table[0].map((h) => h.trim().toLowerCase());
  const known = new Set(templateColumns(cfg));
  for (const r of REQUIRED_FIXED) if (!header.includes(r)) err(1, null, r, `Missing required column "${r}"`);
  for (const a of cfg.attrDefs) if (a.required && !header.includes(`attr_${a.code}`)) err(1, null, `attr_${a.code}`, `Missing required column "attr_${a.code}" (${a.name})`);
  for (const h of header) if (h && !known.has(h)) warn(1, null, h, `Column "${h}" is not recognised and will be ignored`);
  const dup = header.find((h, i) => h && header.indexOf(h) !== i);
  if (dup) err(1, null, dup, `Column "${dup}" appears more than once`);
  if (issues.some((i) => i.level === "error")) return { launches: [], issues, rows: table.length - 1, rawRows: [], rowLaunch: [] };

  const idx = (name: string) => header.indexOf(name);
  const get = (r: string[], name: string) => (idx(name) >= 0 ? (r[idx(name)] ?? "").trim() : "");
  const rawRows: Record<string, string>[] = [];
  const rowLaunch: (string | null)[] = [];
  const byRef = new Map<string, { first: string[]; firstRow: number; rows: { r: string[]; n: number }[] }>();
  const order: string[] = [];

  table.slice(1).forEach((r, i) => {
    const n = i + 2; // file row number including the header
    const raw: Record<string, string> = {};
    header.forEach((h, k) => { if (h) raw[h] = r[k] ?? ""; });
    rawRows.push(raw);
    const ref = get(r, "launch_ref");
    rowLaunch.push(ref || null);
    if (!ref) { err(n, null, "launch_ref", "launch_ref is empty. Every row needs the id of its launch."); return; }
    if (!byRef.has(ref)) { byRef.set(ref, { first: r, firstRow: n, rows: [] }); order.push(ref); }
    byRef.get(ref)!.rows.push({ r, n });
  });

  const launches: ParsedLaunch[] = [];
  for (const ref of order) {
    const g = byRef.get(ref)!;
    const before = issues.filter((x) => x.level === "error").length;
    const E = (row: number, field: string | null, m: string) => err(row, ref, field, m);
    const W = (row: number, field: string | null, m: string) => warn(row, ref, field, m);
    const f = g.first;
    const fr = g.firstRow;

    const productName = get(f, "product_name");
    if (!productName) E(fr, "product_name", "product_name is empty");
    const lineCode = get(f, "line");
    if (!lineCode) E(fr, "line", "line is empty");
    else if (!cfg.lineCodes.has(lineCode)) E(fr, "line", `Unknown line "${lineCode}". Known lines: ${[...cfg.lineCodes].join(", ")}`);
    if (cfg.existingProductCodes.has(ref)) E(fr, "launch_ref", `A product with code "${ref}" already exists in this category. It was probably imported before.`);

    let createdDate = get(f, "created_date");
    if (createdDate && !isDate(createdDate)) { E(fr, "created_date", `"${createdDate}" is not a date. Use YYYY-MM-DD.`); createdDate = ""; }

    // attributes
    const attrs: Record<string, FieldValue> = {};
    for (const a of cfg.attrDefs) {
      const raw = get(f, `attr_${a.code}`);
      if (isEmpty(raw)) { if (a.required) E(fr, `attr_${a.code}`, `${a.name} is required`); continue; }
      const parsed = parseFieldValue(a, raw);
      if (parsed.ok) attrs[a.code] = parsed.value; else E(fr, `attr_${a.code}`, parsed.message);
    }
    // later rows should repeat the same product data; flag differences
    for (const { r, n } of g.rows.slice(1)) {
      for (const a of cfg.attrDefs) {
        const raw = get(r, `attr_${a.code}`);
        if (raw !== "" && raw !== get(f, `attr_${a.code}`)) W(n, `attr_${a.code}`, `Differs from the first row of this launch; the first row is used`);
      }
      if (get(r, "line") && get(r, "line") !== lineCode) W(n, "line", `Differs from the first row of this launch; the first row is used`);
    }

    // specs
    const specs: ParsedLaunch["specs"] = {};
    for (const t of cfg.tests) {
      const mn = num(get(f, `spec_${t.code}_min`));
      const mx = num(get(f, `spec_${t.code}_max`));
      if ((mn !== null && !Number.isFinite(mn)) || (mx !== null && !Number.isFinite(mx))) { E(fr, `spec_${t.code}_min`, `Spec for ${t.name} must be numbers`); continue; }
      if (mn !== null && mx !== null && mn > mx) { E(fr, `spec_${t.code}_min`, `Spec for ${t.name}: min ${mn} is above max ${mx}`); continue; }
      if (mn !== null || mx !== null) specs[t.code] = { min: mn, max: mx };
    }

    // runs
    const runs: ParsedRun[] = [];
    const sorted = [...g.rows].sort((a, b) => Number(get(a.r, "run_no")) - Number(get(b.r, "run_no")));
    const seen = new Set<number>();
    for (const { r, n } of sorted) {
      const rn = Number(get(r, "run_no"));
      if (!Number.isInteger(rn) || rn < 1) { E(n, "run_no", `run_no "${get(r, "run_no")}" must be a whole number from 1`); continue; }
      if (seen.has(rn)) { E(n, "run_no", `Run ${rn} appears twice in this launch`); continue; }
      seen.add(rn);

      let date = get(r, "run_date") || createdDate;
      if (date && !isDate(date)) { E(n, "run_date", `"${date}" is not a date. Use YYYY-MM-DD.`); date = ""; }

      const params: Record<string, number> = {};
      for (const p of cfg.paramDefs) {
        const raw = get(r, `param_${p.code}`);
        if (raw === "") continue;
        const v = num(raw);
        if (v === null || !Number.isFinite(v)) E(n, `param_${p.code}`, `${p.name}: "${raw}" is not a number`);
        else if (v < p.absMin || v > p.absMax) E(n, `param_${p.code}`, `${p.name} ${v} is outside the allowed range ${p.absMin} to ${p.absMax} ${p.unit}`);
        else params[p.code] = v;
      }
      const quality: Record<string, number> = {};
      for (const t of cfg.tests) {
        const raw = get(r, `q_${t.code}`);
        if (raw === "") continue;
        const v = num(raw);
        if (v === null || !Number.isFinite(v)) E(n, `q_${t.code}`, `${t.name}: "${raw}" is not a number`);
        else quality[t.code] = v;
      }
      const lossRaw = get(r, "loss_kg");
      let lossKg: number | null = null;
      if (lossRaw !== "") {
        const v = num(lossRaw);
        if (v === null || !Number.isFinite(v) || v < 0) E(n, "loss_kg", `loss_kg "${lossRaw}" must be zero or more`); else lossKg = v;
      }
      const reasons = get(r, "reason_codes").split(/[;|]/).map((s) => s.trim()).filter(Boolean);
      for (const rc of reasons) if (!cfg.reasonCodes.has(rc)) E(n, "reason_codes", `Unknown reason code "${rc}". Known: ${[...cfg.reasonCodes].join(", ")}`);

      const givenRaw = get(r, "result");
      let given: RunResult | null = null;
      if (givenRaw) {
        const m = (["Pass", "Marginal", "Fail"] as const).find((x) => x.toLowerCase() === givenRaw.toLowerCase());
        if (!m) E(n, "result", `result "${givenRaw}" must be Pass, Marginal or Fail`); else given = m;
      }

      // The result is calculated when quality results exist. Otherwise the file must state it.
      let result: RunResult = given ?? "Pass";
      let resultNotes: string[] = ["Result taken from the imported file"];
      const qIn: QualityIn[] = cfg.tests.filter((t) => quality[t.code] !== undefined).map((t) => ({
        code: t.code, value: quality[t.code], specMin: specs[t.code]?.min ?? null, specMax: specs[t.code]?.max ?? null, critical: t.is_critical,
      }));
      const hasSpecFor = qIn.some((q) => q.specMin !== null || q.specMax !== null);
      if (qIn.length && hasSpecFor) {
        const out = deriveRunResult({ quality: qIn, params: [] });
        const sev = { Pass: 0, Marginal: 1, Fail: 2 } as const;
        result = out.result;
        resultNotes = out.notes.map((x) => `${x} (imported)`);
        if (given && given !== out.result) {
          // History can contain causes the quality columns do not show (equipment, line capability). Never hide a worse recorded result.
          if (sev[given] > sev[out.result]) {
            result = given;
            resultNotes = [`File result ${given} kept: more severe than ${out.result} calculated from the quality results (imported)`, ...resultNotes];
            W(n, "result", `File says ${given} but the quality results give ${out.result}. The more severe file result is kept.`);
          } else W(n, "result", `File says ${given} but the quality results give ${out.result}. The calculated result is used.`);
        }
      } else if (!given) E(n, "result", "No result given and no quality results with specs to calculate it from. Provide result, or q_ and spec_ columns.");

      runs.push({ runNo: rn, date: date || "", params, quality, given, result, resultNotes, lossKg, reasons, notes: get(r, "notes") || null, rows: [n] });
    }
    if (runs.length) {
      for (let i = 0; i < runs.length; i++) if (runs[i].runNo !== i + 1) { E(g.rows[0].n, "run_no", `Runs must be numbered 1, 2, 3 without gaps. Found ${runs.map((x) => x.runNo).join(", ")}.`); break; }
      runs.forEach((run, i) => {
        if (run.result !== "Pass" && i < runs.length - 1 && run.reasons.length === 0)
          E(run.rows[0], "reason_codes", `Run ${run.runNo} was ${run.result} and another run follows, so it needs at least one reason code`);
        if (run.result === "Pass" && i < runs.length - 1) W(run.rows[0], "result", `Run ${run.runNo} passed but run ${runs[i + 1].runNo} follows. Check the order.`);
      });
    } else E(fr, "run_no", "This launch has no valid runs");

    // outcome of the launch
    const last = runs[runs.length - 1];
    const lastRow = last?.rows[0] ?? fr;
    const taRaw = get(g.rows[g.rows.length - 1].r, "ta_decision") || get(f, "ta_decision");
    let ta: ParsedLaunch["taDecision"] = null;
    if (taRaw) {
      const m = (["Accepted", "Accepted with conditions", "Rejected"] as const).find((x) => x.toLowerCase() === taRaw.toLowerCase());
      if (!m) E(lastRow, "ta_decision", `ta_decision "${taRaw}" must be Accepted, Accepted with conditions or Rejected`); else ta = m;
    }
    let status: ParsedLaunch["status"] = "Closed";
    let cancelReason: string | null = null;
    if (last) {
      if (last.result === "Pass") {
        if (!ta) {
          if (opt.assumeAccepted) { ta = "Accepted"; W(lastRow, "ta_decision", "No technical acceptance given. Treated as Accepted because the last run passed."); }
          else E(lastRow, "ta_decision", "The last run passed but ta_decision is empty. Fill it in, or tick the option to treat these as Accepted.");
        } else if (ta === "Rejected") W(lastRow, "ta_decision", "Last run passed but acceptance was Rejected. It will not be used as evidence.");
      } else {
        if (ta && ta !== "Rejected") E(lastRow, "ta_decision", `The last run was ${last.result}, so it cannot be ${ta}`);
        status = "Closed";
        if (!ta) { status = "Cancelled"; cancelReason = "Imported: no technical acceptance recorded"; }
        else ta = "Rejected";
      }
    }
    const taDateRaw = get(g.rows[g.rows.length - 1].r, "ta_date") || get(f, "ta_date");
    let taDate: string | null = null;
    if (taDateRaw) { if (!isDate(taDateRaw)) E(lastRow, "ta_date", `"${taDateRaw}" is not a date. Use YYYY-MM-DD.`); else taDate = taDateRaw; }
    if (!taDate) taDate = last?.date || createdDate || null;
    if (!createdDate) createdDate = runs[0]?.date || taDate || new Date().toISOString().slice(0, 10);
    for (const run of runs) if (!run.date) run.date = createdDate;

    const valid = issues.filter((x) => x.level === "error").length === before;
    launches.push({ ref, productName, lineCode, createdDate, attrs, specs, runs, taDecision: ta, taDate, status, cancelReason, rows: g.rows.map((x) => x.n), valid });
  }
  return { launches, issues, rows: table.length - 1, rawRows, rowLaunch };
}

export const csvOf = (header: string[], rows: Record<string, string>[]) => toCsv([header, ...rows.map((r) => header.map((h) => r[h] ?? ""))]);

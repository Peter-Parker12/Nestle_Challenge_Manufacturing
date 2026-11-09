import { HttpError } from "./auth";
import { q, q1, qc, tx } from "./db";

/**
 * Process setup for a category: process steps, parameters, quality tests and line capability.
 * Rules: items are retired, never deleted. Code and unit are fixed once runs reference them. Limits can only be widened once run data exists.
 * A new parameter or test starts with no history; the recommendation says so.
 */
const CODE_RE = /^[a-z][a-z0-9_]{1,39}$/;

export type ParameterInput = {
  stepId: string; code: string; name: string; unit: string; absMin: number; absMax: number; isCritical?: boolean; isLocked?: boolean; helpText?: string | null;
};
export type TestInput = { code: string; name: string; unit?: string | null; isCritical?: boolean; helpText?: string | null };

export function validateParameterInput(i: ParameterInput): string[] {
  const e: string[] = [];
  if (!CODE_RE.test(String(i.code ?? "").trim())) e.push("Code must start with a lowercase letter and use only lowercase letters, digits and underscores (2 to 40 characters)");
  const n = String(i.name ?? "").trim();
  if (n.length < 2 || n.length > 60) e.push("Name must be 2 to 60 characters");
  const u = String(i.unit ?? "").trim();
  if (!u || u.length > 12) e.push("A unit is required (up to 12 characters)");
  if (!Number.isFinite(i.absMin) || !Number.isFinite(i.absMax)) e.push("Enter the lowest and highest allowed value");
  else if (i.absMin >= i.absMax) e.push("The lowest value must be below the highest");
  return e;
}
export function validateTestInput(i: TestInput): string[] {
  const e: string[] = [];
  if (!CODE_RE.test(String(i.code ?? "").trim())) e.push("Code must start with a lowercase letter and use only lowercase letters, digits and underscores (2 to 40 characters)");
  const n = String(i.name ?? "").trim();
  if (n.length < 2 || n.length > 60) e.push("Name must be 2 to 60 characters");
  if (i.unit && String(i.unit).length > 12) e.push("Unit is at most 12 characters");
  return e;
}

export async function listProcess(categoryId: string) {
  const steps = await q("select id, name, seq from cfg.process_step where category_id=$1 order by seq", [categoryId]);
  const params = await q(
    `select p.id, p.step_id, p.code, p.name, p.unit, p.abs_min, p.abs_max, p.is_critical, p.is_locked, p.help_text, p.valid_to,
       (select count(distinct rp.run_id)::int from core.run_parameter rp where rp.parameter_def_id=p.id and rp.actual is not null) as runs_with_value
     from cfg.parameter_def p join cfg.process_step s on s.id=p.step_id where s.category_id=$1 order by s.seq, p.code`, [categoryId]);
  const tests = await q(
    `select t.id, t.code, t.name, t.unit, t.is_critical, t.status, t.help_text,
       (select count(*)::int from core.run_quality rq where rq.quality_test_def_id=t.id) as results
     from cfg.quality_test_def t where t.category_id=$1 order by t.status, t.code`, [categoryId]);
  const lines = await q("select id, code, name from cfg.line order by code");
  const caps = await q("select line_id, parameter_def_id, cap_min, cap_max from cfg.line_capability where parameter_def_id = any($1::uuid[])", [params.map((p) => p.id)]);
  const totalRuns = (await q1("select count(*)::int as n from core.trial_run r join core.launch_project l on l.id=r.launch_id join core.product p on p.id=l.product_id where p.category_id=$1", [categoryId]))!.n as number;
  return {
    totalRuns, lines,
    steps: steps.map((s) => ({
      ...s,
      parameters: params.filter((p) => p.step_id === s.id).map((p) => ({
        id: p.id, code: p.code, name: p.name, unit: p.unit, absMin: Number(p.abs_min), absMax: Number(p.abs_max), isCritical: p.is_critical, isLocked: p.is_locked,
        helpText: p.help_text, status: p.valid_to ? "Retired" : "Active", runsWithValue: p.runs_with_value,
        capability: Object.fromEntries(caps.filter((c) => c.parameter_def_id === p.id).map((c) => [c.line_id, { min: Number(c.cap_min), max: Number(c.cap_max) }])),
      })),
    })),
    tests: tests.map((t) => ({ id: t.id, code: t.code, name: t.name, unit: t.unit, isCritical: t.is_critical, status: t.status, helpText: t.help_text, results: t.results })),
  };
}

export async function addStep(userId: string, categoryId: string, name: string) {
  const n = name.trim();
  if (n.length < 2 || n.length > 40) throw new HttpError(422, "A step name must be 2 to 40 characters", "validation");
  if (await q1("select 1 from cfg.process_step where category_id=$1 and lower(name)=lower($2)", [categoryId, n])) throw new HttpError(409, `A step called "${n}" already exists`, "conflict");
  return tx({ userId, reason: `New process step ${n}` }, async (c) => {
    const seq = ((await qc(c, "select coalesce(max(seq),0)+1 as n from cfg.process_step where category_id=$1", [categoryId]))[0].n as number);
    return { id: (await qc(c, "insert into cfg.process_step(category_id,name,seq) values ($1,$2,$3) returning id", [categoryId, n, seq]))[0].id as string };
  });
}

export async function addParameter(userId: string, categoryId: string, i: ParameterInput) {
  const errors = validateParameterInput(i);
  if (errors.length) throw new HttpError(422, errors.join("; "), "validation");
  const step = await q1("select id from cfg.process_step where id=$1 and category_id=$2", [i.stepId, categoryId]);
  if (!step) throw new HttpError(404, "Process step not found in this category", "not_found");
  const code = i.code.trim();
  // The import and export files identify parameters by code, so a code must be unique across the whole category.
  if (await q1("select 1 from cfg.parameter_def p join cfg.process_step s on s.id=p.step_id where s.category_id=$1 and p.code=$2", [categoryId, code]))
    throw new HttpError(409, `A parameter with the code "${code}" already exists in this category`, "conflict");
  return tx({ userId, reason: `New process parameter ${code}` }, async (c) => {
    const p = (await qc(c,
      `insert into cfg.parameter_def(step_id,code,name,unit,abs_min,abs_max,is_critical,is_locked,help_text,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [i.stepId, code, i.name.trim(), i.unit.trim(), i.absMin, i.absMax, !!i.isCritical, !!i.isLocked, i.helpText?.trim() || null, userId]))[0];
    // Every line starts able to run the full allowed range; the plant admin narrows it per line.
    await c.query("insert into cfg.line_capability(line_id,parameter_def_id,cap_min,cap_max) select id,$1,$2,$3 from cfg.line", [p.id, i.absMin, i.absMax]);
    return { id: p.id as string };
  });
}

export type ParameterPatch = { name?: string; helpText?: string | null; isCritical?: boolean; isLocked?: boolean; absMin?: number; absMax?: number };

export async function updateParameter(userId: string, id: string, patch: ParameterPatch) {
  const row = await q1("select * from cfg.parameter_def where id=$1", [id]);
  if (!row) throw new HttpError(404, "Parameter not found", "not_found");
  const hasRuns = !!(await q1("select 1 from core.run_parameter where parameter_def_id=$1 limit 1", [id]));
  const errors: string[] = [];
  const next: Record<string, unknown> = {};
  if (patch.name !== undefined) { const n = patch.name.trim(); if (n.length < 2 || n.length > 60) errors.push("Name must be 2 to 60 characters"); else next.name = n; }
  if (patch.helpText !== undefined) next.help_text = patch.helpText?.trim() || null;
  if (patch.isCritical !== undefined) next.is_critical = !!patch.isCritical;
  if (patch.isLocked !== undefined) next.is_locked = !!patch.isLocked;
  if (patch.absMin !== undefined || patch.absMax !== undefined) {
    const mn = patch.absMin ?? Number(row.abs_min);
    const mx = patch.absMax ?? Number(row.abs_max);
    if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn >= mx) errors.push("The lowest value must be below the highest");
    else if (hasRuns && (mn > Number(row.abs_min) || mx < Number(row.abs_max))) errors.push("The allowed range can be widened, but not narrowed, once runs have values");
    else {
      const out = await q1("select 1 from cfg.line_capability where parameter_def_id=$1 and (cap_min < $2 or cap_max > $3) limit 1", [id, mn, mx]);
      if (out) errors.push("A line's capability lies outside this range. Change the capability first.");
      else { next.abs_min = mn; next.abs_max = mx; }
    }
  }
  if (errors.length) throw new HttpError(422, errors.join("; "), "validation");
  const keys = Object.keys(next);
  if (!keys.length) return { id, changed: 0 };
  await tx({ userId, reason: "Process parameter edited" }, async (c) => {
    await c.query(`update cfg.parameter_def set ${keys.map((k, i) => `${k}=$${i + 2}`).join(", ")} where id=$1`, [id, ...keys.map((k) => next[k])]);
  });
  return { id, changed: keys.length };
}

export async function setParameterStatus(userId: string, id: string, status: "Active" | "Retired", reason?: string) {
  const row = await q1("select valid_to from cfg.parameter_def where id=$1", [id]);
  if (!row) throw new HttpError(404, "Parameter not found", "not_found");
  const isRetired = !!row.valid_to;
  if ((status === "Retired") === isRetired) throw new HttpError(409, `The parameter is already ${status}`, "conflict");
  if (status === "Retired" && !reason?.trim()) throw new HttpError(422, "Give a reason for retiring the parameter", "validation");
  await tx({ userId, reason: reason?.trim() || "Process parameter reactivated" }, async (c) => {
    await c.query("update cfg.parameter_def set valid_to = $2 where id=$1", [id, status === "Retired" ? new Date().toISOString().slice(0, 10) : null]);
  });
  return { id, status };
}

export async function setCapability(userId: string, lineId: string, parameterId: string, min: number, max: number) {
  const p = await q1("select abs_min, abs_max, valid_to, code from cfg.parameter_def where id=$1", [parameterId]);
  if (!p) throw new HttpError(404, "Parameter not found", "not_found");
  if (p.valid_to) throw new HttpError(409, "The parameter is retired", "conflict");
  if (!(await q1("select 1 from cfg.line where id=$1", [lineId]))) throw new HttpError(404, "Line not found", "not_found");
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new HttpError(422, "The lowest value must not exceed the highest", "validation");
  if (min < Number(p.abs_min) || max > Number(p.abs_max)) throw new HttpError(422, `Capability must stay inside the allowed range ${Number(p.abs_min)} to ${Number(p.abs_max)}`, "validation");
  await tx({ userId, reason: `Line capability for ${p.code}` }, async (c) => {
    await c.query(
      `insert into cfg.line_capability(line_id,parameter_def_id,cap_min,cap_max) values ($1,$2,$3,$4)
       on conflict (line_id, parameter_def_id) do update set cap_min=excluded.cap_min, cap_max=excluded.cap_max`, [lineId, parameterId, min, max]);
  });
  return { ok: true };
}

export async function addTest(userId: string, categoryId: string, i: TestInput) {
  const errors = validateTestInput(i);
  if (errors.length) throw new HttpError(422, errors.join("; "), "validation");
  const code = i.code.trim();
  if (await q1("select 1 from cfg.quality_test_def where category_id=$1 and code=$2", [categoryId, code])) throw new HttpError(409, `A quality test with the code "${code}" already exists`, "conflict");
  return tx({ userId, reason: `New quality test ${code}` }, async (c) => ({
    id: (await qc(c, "insert into cfg.quality_test_def(category_id,code,name,unit,is_critical,help_text,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [categoryId, code, i.name.trim(), i.unit?.trim() || null, !!i.isCritical, i.helpText?.trim() || null, userId]))[0].id as string,
  }));
}

export async function updateTest(userId: string, id: string, patch: { name?: string; unit?: string | null; isCritical?: boolean; helpText?: string | null }) {
  const row = await q1("select * from cfg.quality_test_def where id=$1", [id]);
  if (!row) throw new HttpError(404, "Quality test not found", "not_found");
  const hasResults = !!(await q1("select 1 from core.run_quality where quality_test_def_id=$1 limit 1", [id]));
  const errors: string[] = [];
  const next: Record<string, unknown> = {};
  if (patch.name !== undefined) { const n = patch.name.trim(); if (n.length < 2 || n.length > 60) errors.push("Name must be 2 to 60 characters"); else next.name = n; }
  if (patch.helpText !== undefined) next.help_text = patch.helpText?.trim() || null;
  if (patch.isCritical !== undefined) next.is_critical = !!patch.isCritical;
  if (patch.unit !== undefined) {
    if (hasResults && (patch.unit ?? null) !== (row.unit ?? null)) errors.push("The unit cannot change once results exist. Retire this test and add a new one.");
    else next.unit = patch.unit?.trim() || null;
  }
  if (errors.length) throw new HttpError(422, errors.join("; "), "validation");
  const keys = Object.keys(next);
  if (!keys.length) return { id, changed: 0 };
  await tx({ userId, reason: "Quality test edited" }, async (c) => {
    await c.query(`update cfg.quality_test_def set ${keys.map((k, i) => `${k}=$${i + 2}`).join(", ")} where id=$1`, [id, ...keys.map((k) => next[k])]);
  });
  return { id, changed: keys.length };
}

export async function setTestStatus(userId: string, id: string, status: "Active" | "Retired", reason?: string) {
  const row = await q1("select status from cfg.quality_test_def where id=$1", [id]);
  if (!row) throw new HttpError(404, "Quality test not found", "not_found");
  if (row.status === status) throw new HttpError(409, `The test is already ${status}`, "conflict");
  if (status === "Retired" && !reason?.trim()) throw new HttpError(422, "Give a reason for retiring the test", "validation");
  await tx({ userId, reason: reason?.trim() || "Quality test reactivated" }, async (c) => { await c.query("update cfg.quality_test_def set status=$2 where id=$1", [id, status]); });
  return { id, status };
}

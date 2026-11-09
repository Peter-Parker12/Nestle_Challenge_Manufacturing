import type { PoolClient } from "pg";
import { HttpError } from "./auth";
import { q, q1, qc, tx } from "./db";
import { deriveRunResult } from "./engine/outcome";
import { recommend, smeRuleFromRow } from "./engine/recommend";
import { ENGINE_VERSION, type AttrDef, type Attrs, type HistLaunch, type LineCaps, type ParamDef, type RecResult, type WeightLevels } from "./engine/types";
import { resolveLevels, weightWarnings } from "./engine/weights";

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export const topN = () => Number(process.env.TOP_N_NEIGHBOURS ?? 7);
export const minMatched = () => Number(process.env.MIN_MATCHED_LAUNCHES ?? 3);

/* ------------------------------------------------------------------ configuration */
export async function loadCategoryConfig(categoryId: string) {
  const attrRows = await q("select * from cfg.attribute_def where category_id=$1 order by code", [categoryId]);
  const paramRows = await q(
    `select p.*, s.seq as step_seq, s.name as step_name from cfg.parameter_def p join cfg.process_step s on s.id=p.step_id
     where s.category_id=$1 and p.valid_to is null order by s.seq, p.code`, [categoryId]);
  const testRows = await q("select * from cfg.quality_test_def where category_id=$1 order by code", [categoryId]);
  const attrDefs: AttrDef[] = attrRows.map((a) => ({
    id: a.id, code: a.code, name: a.name, unit: a.unit, type: a.data_type, choices: a.choices, required: a.required, absMin: num(a.abs_min), absMax: num(a.abs_max),
  }));
  const paramDefs: ParamDef[] = paramRows.map((p) => ({
    id: p.id, code: p.code, name: p.name, unit: p.unit, absMin: Number(p.abs_min), absMax: Number(p.abs_max), isCritical: p.is_critical, isLocked: p.is_locked, stepSeq: p.step_seq,
  }));
  return { attrDefs, paramDefs, tests: testRows as { id: string; code: string; name: string; unit: string | null; is_critical: boolean }[] };
}

export async function loadLineCaps(lineId: string, paramDefs: ParamDef[]): Promise<LineCaps> {
  const rows = await q("select parameter_def_id, cap_min, cap_max from cfg.line_capability where line_id=$1", [lineId]);
  const byId = new Map(paramDefs.map((p) => [p.id, p.code]));
  const out: LineCaps = {};
  rows.forEach((r) => {
    const code = byId.get(r.parameter_def_id);
    if (code) out[code] = { min: Number(r.cap_min), max: Number(r.cap_max) };
  });
  return out;
}

export async function loadRules(categoryId: string) {
  const rows = await q("select * from cfg.sme_rule where category_id=$1 and status='Active'", [categoryId]);
  return rows.map(smeRuleFromRow);
}

/** Active weight set at a level, as {code: level}. */
async function weightLayer(where: string, param: string, defs: { id: string; code: string }[]) {
  const set = await q1(`select id from rec.weight_set where status='Active' and ${where} order by effective_from desc limit 1`, [param]);
  if (!set) return null;
  const items = await q("select kind, item_id, weight from rec.weight_item where weight_set_id=$1", [set.id]);
  const byId = new Map(defs.map((d) => [d.id, d.code]));
  const attributes: Record<string, number> = {};
  const parameters: Record<string, number> = {};
  items.forEach((i) => {
    const code = byId.get(i.item_id);
    if (!code) return;
    (i.kind === "attribute" ? attributes : parameters)[code] = Number(i.weight);
  });
  return { id: set.id as string, attributes, parameters };
}

export async function resolveWeights(categoryId: string, launchId: string, attrDefs: AttrDef[], paramDefs: ParamDef[], override?: WeightLevels) {
  const defs = [...attrDefs, ...paramDefs];
  const cat = await weightLayer("level='category' and category_id=$1", categoryId, defs);
  const rec = await weightLayer("level='recipe' and launch_id=$1", launchId, defs);
  const attrs = resolveLevels(attrDefs.map((a) => a.code), { category: cat?.attributes, recipe: override?.attributes ?? rec?.attributes });
  const params = resolveLevels(paramDefs.map((p) => p.code), { category: cat?.parameters, recipe: override?.parameters ?? rec?.parameters });
  return {
    levels: { attributes: attrs.levels, parameters: params.levels } as WeightLevels,
    source: { attributes: attrs.source, parameters: params.source },
    categorySetId: cat?.id ?? null,
    recipeSetId: rec?.id ?? null,
    categoryLevels: { attributes: cat?.attributes ?? {}, parameters: cat?.parameters ?? {} } as WeightLevels,
  };
}

/* ------------------------------------------------------------------ history */
export async function loadHistory(categoryId: string, asOf: Date, excludeLaunchId?: string): Promise<HistLaunch[]> {
  const launches = await q(
    `select l.id, l.code, l.line_id, l.product_id, p.name,
       (select count(*)::int from core.trial_run r where r.launch_id=l.id) as runs,
       (select coalesce(sum(loss_kg),0) from core.trial_run r where r.launch_id=l.id) as loss,
       (select result from core.trial_run r where r.launch_id=l.id and r.run_no=1) as first_result,
       (select id from core.trial_run r where r.launch_id=l.id order by (r.result='Pass') desc, r.run_no desc limit 1) as accepted_run
     from core.launch_project l join core.product p on p.id=l.product_id
     where p.category_id=$1 and l.status='Closed' and l.ta_decision in ('Accepted','Accepted with conditions')
       and l.closed_at <= $2 and ($3::uuid is null or l.id <> $3)`,
    [categoryId, asOf, excludeLaunchId ?? null]);
  if (!launches.length) return [];
  const productIds = launches.map((l) => l.product_id);
  const attrRows = await q(
    `select v.product_id, a.code, a.data_type, v.value_num, v.value_choice from core.product_attribute_value v
     join cfg.attribute_def a on a.id=v.attribute_def_id where v.product_id = any($1::uuid[])`, [productIds]);
  const runIds = launches.map((l) => l.accepted_run).filter(Boolean);
  const paramRows = await q(
    `select rp.run_id, p.code, rp.actual from core.run_parameter rp join cfg.parameter_def p on p.id=rp.parameter_def_id
     where rp.run_id = any($1::uuid[]) and rp.actual is not null`, [runIds]);
  const reasonRows = await q(
    `select r.launch_id, rr.reason_code from core.run_reason rr join core.trial_run r on r.id=rr.run_id
     where r.launch_id = any($1::uuid[])`, [launches.map((l) => l.id)]);

  const attrsBy = new Map<string, Attrs>();
  attrRows.forEach((r) => {
    const m = attrsBy.get(r.product_id) ?? {};
    m[r.code] = r.data_type === "numeric" ? Number(r.value_num) : r.value_choice;
    attrsBy.set(r.product_id, m);
  });
  const paramsBy = new Map<string, Record<string, number>>();
  paramRows.forEach((r) => {
    const m = paramsBy.get(r.run_id) ?? {};
    m[r.code] = Number(r.actual);
    paramsBy.set(r.run_id, m);
  });
  const reasonsBy = new Map<string, string[]>();
  reasonRows.forEach((r) => reasonsBy.set(r.launch_id, [...(reasonsBy.get(r.launch_id) ?? []), r.reason_code]));

  return launches.map((l) => ({
    launchId: l.id, code: l.code, productName: l.name, lineId: l.line_id,
    attrs: attrsBy.get(l.product_id) ?? {},
    acceptedParams: l.accepted_run ? paramsBy.get(l.accepted_run) ?? null : null,
    runs: l.runs, totalLossKg: Number(l.loss), firstPass: l.first_result === "Pass", reasons: reasonsBy.get(l.id) ?? [],
  }));
}

/* ------------------------------------------------------------------ launches */
export async function listLaunches() {
  return q(
    `select l.id, l.code, l.status, l.created_at, l.ta_decision, p.name as product, c.name as category, ln.code as line,
       (select count(*)::int from core.trial_run r where r.launch_id=l.id) as runs,
       (select result from core.trial_run r where r.launch_id=l.id order by run_no desc limit 1) as last_result
     from core.launch_project l join core.product p on p.id=l.product_id join cfg.category c on c.id=p.category_id
     join cfg.line ln on ln.id=l.line_id order by l.created_at desc limit 200`);
}

export async function getProductAttrs(productId: string): Promise<Attrs> {
  const rows = await q(
    `select a.code, a.data_type, v.value_num, v.value_choice from core.product_attribute_value v
     join cfg.attribute_def a on a.id=v.attribute_def_id where v.product_id=$1`, [productId]);
  const out: Attrs = {};
  rows.forEach((r) => (out[r.code] = r.data_type === "numeric" ? Number(r.value_num) : r.value_choice));
  return out;
}

async function launchCore(launchId: string) {
  const l = await q1(
    `select l.*, p.name as product_name, p.code as product_code, p.category_id, p.id as pid, ln.code as line_code, c.code as category_code, c.name as category_name
     from core.launch_project l join core.product p on p.id=l.product_id join cfg.category c on c.id=p.category_id join cfg.line ln on ln.id=l.line_id where l.id=$1`, [launchId]);
  if (!l) throw new HttpError(404, "Launch not found", "not_found");
  return l;
}

export async function createLaunch(
  userId: string,
  input: { categoryId: string; lineId: string; name: string; code?: string; objective?: string; attrs: Attrs; specs: Record<string, { min: number | null; max: number | null }> },
) {
  const { attrDefs, tests } = await loadCategoryConfig(input.categoryId);
  // Validate attributes against their definitions (required, type, sane range, choice membership).
  const errors: string[] = [];
  const clean: Attrs = {};
  for (const a of attrDefs) {
    const v = input.attrs[a.code];
    if (v === undefined || v === null || v === "") {
      if (a.required) errors.push(`${a.name} is required`);
      continue;
    }
    if (a.type === "numeric") {
      const n = Number(v);
      if (!Number.isFinite(n)) errors.push(`${a.name} must be a number`);
      else if ((a.absMin !== null && n < a.absMin) || (a.absMax !== null && n > a.absMax)) errors.push(`${a.name} must be between ${a.absMin} and ${a.absMax}`);
      else clean[a.code] = n;
    } else if (!a.choices?.includes(String(v))) errors.push(`${a.name} must be one of ${a.choices?.join(", ")}`);
    else clean[a.code] = String(v);
  }
  if (!input.name.trim()) errors.push("Product name is required");
  if (errors.length) throw new HttpError(422, errors.join("; "), "validation");
  for (const [k, s] of Object.entries(input.specs))
    if (s.min !== null && s.max !== null && s.min > s.max) throw new HttpError(422, `Spec for ${k}: min must not exceed max`, "validation");

  return tx({ userId }, async (c) => {
    const code = input.code?.trim() || `P-${Date.now().toString(36).toUpperCase()}`;
    const p = (await qc(c, "insert into core.product(category_id,code,name) values ($1,$2,$3) returning id", [input.categoryId, code, input.name.trim()]))[0];
    for (const a of attrDefs) {
      const v = clean[a.code];
      if (v === undefined) continue;
      await c.query("insert into core.product_attribute_value(product_id,attribute_def_id,value_num,value_choice) values ($1,$2,$3,$4)",
        [p.id, a.id, a.type === "numeric" ? v : null, a.type === "choice" ? v : null]);
    }
    for (const t of tests) {
      const s = input.specs[t.code];
      if (s && (s.min !== null || s.max !== null)) await c.query("insert into core.product_spec values ($1,$2,$3,$4)", [p.id, t.id, s.min, s.max]);
    }
    const l = (await qc(c, "insert into core.launch_project(product_id,line_id,objective,created_by) values ($1,$2,$3,$4) returning id, code", [p.id, input.lineId, input.objective ?? null, userId]))[0];
    return l as { id: string; code: string };
  });
}

/* ------------------------------------------------------------------ recommendation */
async function buildRecInput(launchId: string, override?: WeightLevels) {
  const l = await launchCore(launchId);
  const cfg = await loadCategoryConfig(l.category_id);
  const attrs = await getProductAttrs(l.pid);
  const lineCaps = await loadLineCaps(l.line_id, cfg.paramDefs);
  const rules = await loadRules(l.category_id);
  const asOf = new Date();
  const history = await loadHistory(l.category_id, asOf, launchId);
  const w = await resolveWeights(l.category_id, launchId, cfg.attrDefs, cfg.paramDefs, override);
  return {
    launch: l, asOf, w, cfg,
    input: { attrDefs: cfg.attrDefs, paramDefs: cfg.paramDefs, target: attrs, lineId: l.line_id, lineCaps, history, weights: w.levels, rules, topN: topN(), minMatched: minMatched() },
  };
}

/** Compute without saving. Used for the "default weights vs your weights" comparison (BR-11). */
export async function previewRecommendation(launchId: string, override?: WeightLevels) {
  const b = await buildRecInput(launchId, override);
  const result = recommend(b.input);
  return { result, weights: b.w, warnings: weightWarnings(b.w.levels, result.nMatched, minMatched()) };
}

export async function createRecommendation(launchId: string, userId: string) {
  const b = await buildRecInput(launchId);
  if (["Closed", "Cancelled"].includes(b.launch.status)) throw new HttpError(409, `Launch is ${b.launch.status}`, "conflict");
  const result: RecResult = recommend(b.input);
  const nextRun = ((await q1("select coalesce(max(run_no),0)+1 as n from core.trial_run where launch_id=$1", [launchId]))?.n as number) ?? 1;
  const pById = new Map(b.cfg.paramDefs.map((p) => [p.code, p.id]));

  return tx({ userId }, async (c) => {
    const rec = (await qc(c,
      `insert into rec.recommendation(launch_id,run_no_target,weight_set_id,weights_snapshot,engine_version,history_as_of,n_matched,confidence,overall_risk,created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [launchId, nextRun, b.w.recipeSetId ?? b.w.categorySetId,
        JSON.stringify({ levels: b.w.levels, normalised: result.normalisedWeights, source: b.w.source }),
        ENGINE_VERSION, b.asOf, result.nMatched, result.confidence, result.overallRisk, userId]))[0];
    for (const l of result.lines)
      await c.query("insert into rec.recommendation_line values ($1,$2,$3,$4,$5,$6,$7)", [rec.id, pById.get(l.code), l.startValue, l.windowLow, l.windowHigh, l.clipped, l.clipReason ?? null]);
    for (const n of result.neighbours) await c.query("insert into rec.recommendation_evidence values ($1,$2,$3,$4,$5)", [rec.id, n.launchId, n.similarity, n.rank, n.wasGood]);
    for (const f of result.flags)
      await c.query("insert into rec.risk_flag(recommendation_id,flag_type,severity,message,detail,sme_rule_id) values ($1,$2,$3,$4,$5,$6)",
        [rec.id, f.type, f.severity, f.message, f.detail ? JSON.stringify(f.detail) : null, f.smeRuleId ?? null]);
    await c.query("update core.launch_project set status='Recommended' where id=$1 and status in ('Draft','In review','Recommended','Results entered')", [launchId]);
    return { id: rec.id as string, result };
  });
}

export async function saveRecipeWeights(launchId: string, userId: string, w: WeightLevels, reason: string) {
  if (!reason.trim()) throw new HttpError(422, "A reason is required when changing weights (BR-07)", "validation");
  const l = await launchCore(launchId);
  if (["Closed", "Cancelled"].includes(l.status)) throw new HttpError(409, `Launch is ${l.status}`, "conflict");
  const cfg = await loadCategoryConfig(l.category_id);
  const attrById = new Map(cfg.attrDefs.map((a) => [a.code, a.id]));
  const paramById = new Map(cfg.paramDefs.map((p) => [p.code, p.id]));
  const clamp = (n: number) => {
    if (!Number.isInteger(n) || n < 0 || n > 5) throw new HttpError(422, "Weights must be whole numbers from 0 to 5", "validation");
    return n;
  };
  return tx({ userId, reason }, async (c) => {
    const prev = await qc(c, "select id from rec.weight_set where level='recipe' and launch_id=$1 and status='Active'", [launchId]);
    const set = (await qc(c,
      "insert into rec.weight_set(level,launch_id,status,created_by,approved_by,reason,supersedes_id) values ('recipe',$1,'Active',$2,$2,$3,$4) returning id",
      [launchId, userId, reason, prev[0]?.id ?? null]))[0];
    if (prev[0]) await c.query("update rec.weight_set set status='Retired' where id=$1", [prev[0].id]);
    for (const [code, v] of Object.entries(w.attributes)) if (attrById.has(code)) await c.query("insert into rec.weight_item values ($1,'attribute',$2,$3)", [set.id, attrById.get(code), clamp(v)]);
    for (const [code, v] of Object.entries(w.parameters)) if (paramById.has(code)) await c.query("insert into rec.weight_item values ($1,'parameter',$2,$3)", [set.id, paramById.get(code), clamp(v)]);
    return { id: set.id as string };
  });
}

export async function decide(
  launchId: string, recId: string, userId: string,
  d: { action: "approved" | "edited" | "rejected"; finalValues?: Record<string, number>; reason?: string; secondApproverId?: string },
) {
  const rec = await q1("select * from rec.recommendation where id=$1 and launch_id=$2", [recId, launchId]);
  if (!rec) throw new HttpError(404, "Recommendation not found", "not_found");
  const already = await q1("select 1 from rec.decision where recommendation_id=$1", [recId]);
  if (already) throw new HttpError(409, "This recommendation already has a decision", "conflict");
  if (rec.confidence === "Low" && d.action !== "rejected" && !d.reason?.trim())
    throw new HttpError(422, "Confidence is Low: a written reason is required to approve (BR-04)", "validation");
  if (d.action === "edited" && !d.finalValues) throw new HttpError(422, "Edited decisions need the final values", "validation");

  const cfgRows = await q("select p.id, p.code, p.abs_min, p.abs_max from rec.recommendation_line l join cfg.parameter_def p on p.id=l.parameter_def_id where l.recommendation_id=$1", [recId]);
  const lines = await q("select parameter_def_id, start_value from rec.recommendation_line where recommendation_id=$1", [recId]);
  const launch = await launchCore(launchId);
  const cfg = await loadCategoryConfig(launch.category_id);
  const caps = await loadLineCaps(launch.line_id, cfg.paramDefs);

  let planned: Record<string, number> = {};
  if (d.action !== "rejected") {
    // BR-02: edited values must stay inside line capability.
    for (const p of cfgRows) {
      const rl = lines.find((x) => x.parameter_def_id === p.id);
      const v = d.action === "edited" ? d.finalValues![p.code] ?? Number(rl?.start_value) : Number(rl?.start_value);
      const cap = caps[p.code] ?? { min: Number(p.abs_min), max: Number(p.abs_max) };
      if (v < cap.min || v > cap.max) throw new HttpError(422, `${p.code} ${v} is outside line capability (${cap.min} to ${cap.max})`, "validation");
      planned[p.code] = v;
    }
  }

  return tx({ userId, reason: d.reason }, async (c) => {
    await c.query("insert into rec.decision(recommendation_id,action,final_values,reason,decided_by,second_approver) values ($1,$2,$3,$4,$5,$6)",
      [recId, d.action, d.action === "rejected" ? null : JSON.stringify(planned), d.reason ?? null, userId, d.secondApproverId ?? null]);
    if (d.action === "rejected") {
      await c.query("update core.launch_project set status='In review' where id=$1", [launchId]);
      return { runId: null as string | null };
    }
    const run = (await qc(c, "insert into core.trial_run(launch_id,run_no,plan_rec_id,status) values ($1,$2,$3,'Planned') returning id", [launchId, rec.run_no_target, recId]))[0];
    for (const p of cfgRows) await c.query("insert into core.run_parameter(run_id,parameter_def_id,planned) values ($1,$2,$3)", [run.id, p.id, planned[p.code]]);
    await c.query("update core.launch_project set status='Approved' where id=$1", [launchId]);
    return { runId: run.id as string };
  });
}

/* ------------------------------------------------------------------ runs */
export async function startRun(runId: string, userId: string) {
  return tx({ userId }, async (c) => {
    const r = (await qc(c, "update core.trial_run set status='Running', started_at=now() where id=$1 and status='Planned' returning launch_id", [runId]))[0];
    if (!r) throw new HttpError(409, "Run is not in Planned state", "conflict");
    await c.query("update core.launch_project set status='Trial running' where id=$1", [r.launch_id]);
  });
}

export async function enterResults(
  runId: string, userId: string,
  d: { actuals: Record<string, number>; quality: Record<string, number>; lossKg?: number | null; lossNote?: string; aborted?: boolean; notes?: string },
) {
  const run = await q1("select * from core.trial_run where id=$1", [runId]);
  if (!run) throw new HttpError(404, "Run not found", "not_found");
  if (!["Planned", "Running"].includes(run.status)) throw new HttpError(409, `Run is ${run.status}; results can only be entered once`, "conflict");
  const l = await launchCore(run.launch_id);
  const cfg = await loadCategoryConfig(l.category_id);
  const caps = await loadLineCaps(l.line_id, cfg.paramDefs);
  const specs = await q(
    `select t.id, t.code, t.is_critical, s.spec_min, s.spec_max from cfg.quality_test_def t
     left join core.product_spec s on s.quality_test_def_id=t.id and s.product_id=$2 where t.category_id=$1`, [l.category_id, l.pid]);

  const errors: string[] = [];
  for (const [code, v] of Object.entries(d.actuals)) {
    const p = cfg.paramDefs.find((x) => x.code === code);
    if (!p) errors.push(`Unknown parameter ${code}`);
    else if (!Number.isFinite(v) || v < p.absMin || v > p.absMax) errors.push(`${p.name} must be between ${p.absMin} and ${p.absMax} ${p.unit}`);
  }
  for (const [code, v] of Object.entries(d.quality)) {
    if (!specs.find((s) => s.code === code)) errors.push(`Unknown quality test ${code}`);
    else if (!Number.isFinite(v)) errors.push(`${code} must be a number`);
  }
  if (d.lossKg !== null && d.lossKg !== undefined && (!Number.isFinite(d.lossKg) || d.lossKg < 0)) errors.push("Loss must be zero or more");
  if (!d.aborted && !Object.keys(d.quality).length) errors.push("Enter at least one quality result, or mark the run as aborted");
  if (errors.length) throw new HttpError(422, errors.join("; "), "validation");

  const qIn = specs.filter((s) => d.quality[s.code] !== undefined).map((s) => ({
    code: s.code, value: d.quality[s.code], specMin: num(s.spec_min), specMax: num(s.spec_max), critical: s.is_critical,
  }));
  const pIn = Object.entries(d.actuals).map(([code, actual]) => ({ code, actual, capMin: caps[code]?.min, capMax: caps[code]?.max }));
  const out = deriveRunResult({ aborted: d.aborted, quality: qIn, params: pIn });

  return tx({ userId }, async (c) => {
    for (const [code, v] of Object.entries(d.actuals)) {
      const p = cfg.paramDefs.find((x) => x.code === code)!;
      await c.query(
        `insert into core.run_parameter(run_id,parameter_def_id,actual) values ($1,$2,$3)
         on conflict (run_id,parameter_def_id) do update set actual=excluded.actual`, [runId, p.id, v]);
    }
    for (const s of specs) {
      if (d.quality[s.code] === undefined) continue;
      await c.query("insert into core.run_quality(run_id,quality_test_def_id,value,spec_min,spec_max,pass) values ($1,$2,$3,$4,$5,true)",
        [runId, s.id, d.quality[s.code], s.spec_min, s.spec_max]);
    }
    await c.query(
      `update core.trial_run set status='Results entered', ended_at=now(), result=$2, result_notes=$3, aborted=$4, loss_kg=$5, loss_note=$6, notes=$7,
         started_at=coalesce(started_at, now()) where id=$1`,
      [runId, out.result, JSON.stringify(out.notes), !!d.aborted, d.lossKg ?? null, d.lossNote ?? null, d.notes ?? null]);
    await c.query("update core.launch_project set status='Results entered' where id=$1", [run.launch_id]);
    return out;
  });
}

export async function reviewRun(
  runId: string, userId: string,
  d: { reasons: string[]; nextStep: "TA" | "Repeat" | "Stop"; overrideResult?: "Pass" | "Marginal" | "Fail"; overrideReason?: string; comment?: string },
) {
  const run = await q1("select * from core.trial_run where id=$1", [runId]);
  if (!run) throw new HttpError(404, "Run not found", "not_found");
  if (run.status !== "Results entered") throw new HttpError(409, "Enter results before reviewing the run", "conflict");
  const finalResult = d.overrideResult ?? run.result;
  if (d.overrideResult && d.overrideResult !== run.result && !d.overrideReason?.trim())
    throw new HttpError(422, "Overriding the calculated result needs a reason (BR-13)", "validation");
  if (finalResult !== "Pass" && !d.reasons.length) throw new HttpError(422, "A Marginal or Fail run needs at least one reason code (BR-14)", "validation");
  if (finalResult !== "Pass" && d.nextStep === "TA") throw new HttpError(422, "Only a Pass run can go to Technical Acceptance. Choose Repeat or Stop.", "validation");

  return tx({ userId, reason: d.overrideReason }, async (c) => {
    for (const rc of d.reasons) await c.query("insert into core.run_reason(run_id,reason_code,comment) values ($1,$2,$3) on conflict do nothing", [runId, rc, d.comment ?? null]);
    const overridden = !!d.overrideResult && d.overrideResult !== run.result;
    await c.query(
      "update core.trial_run set status='Closed', next_step=$2, result=$3, result_overridden=$4, result_override_reason=$5, result_override_by=$6 where id=$1",
      [runId, d.nextStep, finalResult, overridden, overridden ? d.overrideReason : null, overridden ? userId : null]);
    if (d.nextStep === "Stop") await c.query("update core.launch_project set status='Cancelled', cancel_reason=$2 where id=$1", [run.launch_id, d.comment ?? "Stopped after run review"]);
    else await c.query("update core.launch_project set status=$2 where id=$1", [run.launch_id, d.nextStep === "TA" ? "Results entered" : "In review"]);
    return { result: finalResult as string };
  });
}

export async function recordTA(launchId: string, userId: string, decision: "Accepted" | "Accepted with conditions" | "Rejected") {
  const l = await launchCore(launchId);
  const last = await q1("select * from core.trial_run where launch_id=$1 order by run_no desc limit 1", [launchId]);
  if (!last || last.status !== "Closed") throw new HttpError(409, "Review the latest run before recording Technical Acceptance", "conflict");
  if (decision !== "Rejected" && last.result !== "Pass") throw new HttpError(409, "The latest run did not pass; it cannot be accepted", "conflict");
  if (["Closed", "Cancelled"].includes(l.status)) throw new HttpError(409, `Launch is already ${l.status}`, "conflict");
  return tx({ userId }, async (c) => {
    await c.query("update core.launch_project set ta_decision=$2, ta_date=current_date, ta_by=$3, status='Closed', closed_at=now() where id=$1", [launchId, decision, userId]);
  });
}

export async function cancelLaunch(launchId: string, userId: string, reason: string) {
  if (!reason.trim()) throw new HttpError(422, "A reason is required to cancel", "validation");
  const l = await launchCore(launchId);
  if (["Closed", "Cancelled"].includes(l.status)) throw new HttpError(409, `Launch is already ${l.status}`, "conflict");
  return tx({ userId, reason }, async (c) => {
    await c.query("update core.launch_project set status='Cancelled', cancel_reason=$2 where id=$1", [launchId, reason]);
  });
}

/* ------------------------------------------------------------------ detail view */
export async function getLaunchDetail(launchId: string) {
  const l = await launchCore(launchId);
  const cfg = await loadCategoryConfig(l.category_id);
  const attrs = await getProductAttrs(l.pid);
  const caps = await loadLineCaps(l.line_id, cfg.paramDefs);
  const specs = await q(
    `select t.code, t.name, t.is_critical, s.spec_min, s.spec_max from cfg.quality_test_def t
     left join core.product_spec s on s.quality_test_def_id=t.id and s.product_id=$2 where t.category_id=$1 order by t.code`, [l.category_id, l.pid]);
  const runs = await q("select * from core.trial_run where launch_id=$1 order by run_no", [launchId]);
  const ids = runs.map((r) => r.id);
  const params = ids.length ? await q("select rp.run_id, p.code, rp.planned, rp.actual from core.run_parameter rp join cfg.parameter_def p on p.id=rp.parameter_def_id where rp.run_id = any($1::uuid[])", [ids]) : [];
  const quality = ids.length ? await q("select rq.run_id, t.code, rq.value, rq.spec_min, rq.spec_max, rq.pass from core.run_quality rq join cfg.quality_test_def t on t.id=rq.quality_test_def_id where rq.run_id = any($1::uuid[])", [ids]) : [];
  const reasons = ids.length ? await q("select rr.run_id, rr.reason_code, c.label from core.run_reason rr join cfg.reason_code c on c.code=rr.reason_code where rr.run_id = any($1::uuid[])", [ids]) : [];
  const recs = await q("select * from rec.recommendation where launch_id=$1 order by created_at desc", [launchId]);
  const recIds = recs.map((r) => r.id);
  const lines = recIds.length ? await q("select rl.*, p.code from rec.recommendation_line rl join cfg.parameter_def p on p.id=rl.parameter_def_id where rl.recommendation_id = any($1::uuid[])", [recIds]) : [];
  const ev = recIds.length ? await q("select e.*, l.code as launch_code, p.name as product_name from rec.recommendation_evidence e join core.launch_project l on l.id=e.evidence_launch_id join core.product p on p.id=l.product_id where e.recommendation_id = any($1::uuid[]) order by e.rank", [recIds]) : [];
  const flags = recIds.length ? await q("select * from rec.risk_flag where recommendation_id = any($1::uuid[])", [recIds]) : [];
  const decisions = recIds.length ? await q("select d.*, u.name as decided_by_name from rec.decision d left join cfg.app_user u on u.id=d.decided_by where d.recommendation_id = any($1::uuid[])", [recIds]) : [];
  const w = await resolveWeights(l.category_id, launchId, cfg.attrDefs, cfg.paramDefs);
  const reasonCodes = await q("select code, label from cfg.reason_code where active order by label");

  return {
    launch: { id: l.id, code: l.code, status: l.status, objective: l.objective, createdAt: l.created_at, taDecision: l.ta_decision, taDate: l.ta_date, cancelReason: l.cancel_reason, lineId: l.line_id, line: l.line_code, categoryId: l.category_id, category: l.category_name, productName: l.product_name, productCode: l.product_code },
    attrs, attrDefs: cfg.attrDefs, paramDefs: cfg.paramDefs, lineCaps: caps, specs, reasonCodes,
    weights: { levels: w.levels, source: w.source, categoryLevels: w.categoryLevels, warnings: weightWarnings(w.levels) },
    runs: runs.map((r) => ({
      id: r.id, runNo: r.run_no, status: r.status, result: r.result, resultNotes: r.result_notes, overridden: r.result_overridden, overrideReason: r.result_override_reason,
      aborted: r.aborted, lossKg: num(r.loss_kg), nextStep: r.next_step, notes: r.notes, planRecId: r.plan_rec_id, startedAt: r.started_at,
      params: params.filter((p) => p.run_id === r.id).map((p) => ({ code: p.code, planned: num(p.planned), actual: num(p.actual) })),
      quality: quality.filter((x) => x.run_id === r.id).map((x) => ({ code: x.code, value: Number(x.value), specMin: num(x.spec_min), specMax: num(x.spec_max), pass: x.pass })),
      reasons: reasons.filter((x) => x.run_id === r.id).map((x) => ({ code: x.reason_code, label: x.label })),
    })),
    recommendations: recs.map((r) => ({
      id: r.id, runNoTarget: r.run_no_target, createdAt: r.created_at, confidence: r.confidence, overallRisk: r.overall_risk, nMatched: r.n_matched, engineVersion: r.engine_version, weights: r.weights_snapshot,
      lines: lines.filter((x) => x.recommendation_id === r.id).map((x) => ({ code: x.code, startValue: Number(x.start_value), windowLow: Number(x.window_low), windowHigh: Number(x.window_high), clipped: x.clipped, clipReason: x.clip_reason })),
      evidence: ev.filter((x) => x.recommendation_id === r.id).map((x) => ({ launchId: x.evidence_launch_id, code: x.launch_code, productName: x.product_name, similarity: Number(x.similarity), rank: x.rank, wasGood: x.was_good })),
      flags: flags.filter((x) => x.recommendation_id === r.id).map((x) => ({ type: x.flag_type, severity: x.severity, message: x.message, detail: x.detail })),
      decision: decisions.filter((x) => x.recommendation_id === r.id).map((x) => ({ action: x.action, reason: x.reason, finalValues: x.final_values, by: x.decided_by_name, at: x.decided_at }))[0] ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ dashboard */
export async function dashboardKpis() {
  const groups = await q(
    `select used_recommendation as used, count(*)::int as launches,
       round(100.0*avg((first_pass)::int),0) as first_pass_pct, round(avg(runs),2) as avg_runs, round(avg(total_loss_kg),0) as avg_loss, round(avg(days_to_ta),1) as avg_days
     from core.launch_kpi_v where status='Closed' group by used_recommendation`);
  const open = await q("select status, count(*)::int as n from core.launch_project where status not in ('Closed','Cancelled') group by status");
  const total = await q1("select count(*)::int as n from core.launch_project where status='Closed'");
  const byCat = await q("select c.name, count(*)::int as launches from core.launch_project l join core.product p on p.id=l.product_id join cfg.category c on c.id=p.category_id group by c.name");
  const usage = await q1(
    `select count(*) filter (where d.action in ('approved','edited'))::int as followed, count(*)::int as decided,
       count(*) filter (where d.action='approved')::int as approved_as_is from rec.decision d`);
  return { groups, open, closed: total?.n ?? 0, byCat, usage };
}

export async function listCategories() {
  return q("select id, code, name from cfg.category where active order by name");
}
export async function listLines() {
  return q("select id, code, name from cfg.line order by code");
}
export async function listUsers() {
  return q("select id, name, role from cfg.app_user where active order by role, name");
}
export async function auditEvents(limit = 100) {
  return q("select e.id, e.at, e.action, e.entity, e.entity_id, e.reason, u.name as user_name, e.after from audit.event e left join cfg.app_user u on u.id=e.user_id order by e.id desc limit $1", [limit]);
}

/* ------------------------------------------------------------------ category default weights */
export async function categoryWeightLevels(categoryId: string, attrDefs: AttrDef[], paramDefs: ParamDef[]): Promise<WeightLevels> {
  const layer = await weightLayer("level='category' and category_id=$1", categoryId, [...attrDefs, ...paramDefs]);
  return { attributes: layer?.attributes ?? {}, parameters: layer?.parameters ?? {} };
}

export async function saveCategoryWeights(categoryId: string, userId: string, w: WeightLevels, reason: string) {
  if (!reason.trim()) throw new HttpError(422, "A reason is required when changing weights (BR-07)", "validation");
  const cfg = await loadCategoryConfig(categoryId);
  const attrById = new Map(cfg.attrDefs.map((a) => [a.code, a.id]));
  const paramById = new Map(cfg.paramDefs.map((p) => [p.code, p.id]));
  const ok = (n: number) => {
    if (!Number.isInteger(n) || n < 0 || n > 5) throw new HttpError(422, "Weights must be whole numbers from 0 to 5", "validation");
    return n;
  };
  return tx({ userId, reason }, async (c) => {
    const prev = await qc(c, "select id from rec.weight_set where level='category' and category_id=$1 and status='Active'", [categoryId]);
    const set = (await qc(c,
      "insert into rec.weight_set(level,category_id,status,created_by,approved_by,reason,supersedes_id) values ('category',$1,'Active',$2,$2,$3,$4) returning id",
      [categoryId, userId, reason, prev[0]?.id ?? null]))[0];
    if (prev[0]) await c.query("update rec.weight_set set status='Retired' where id=$1", [prev[0].id]);
    for (const [code, v] of Object.entries(w.attributes)) if (attrById.has(code)) await c.query("insert into rec.weight_item values ($1,'attribute',$2,$3)", [set.id, attrById.get(code), ok(v)]);
    for (const [code, v] of Object.entries(w.parameters)) if (paramById.has(code)) await c.query("insert into rec.weight_item values ($1,'parameter',$2,$3)", [set.id, paramById.get(code), ok(v)]);
    return { id: set.id as string };
  });
}

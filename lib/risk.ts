import { HttpError } from "./auth";
import { q, q1, qc, tx } from "./db";
import { DEFAULT_WEIGHTS, FACTORS, FACTOR_LABEL, HIGH_AT, MEDIUM_AT, SEAL_ENGINE_VERSION, projectHigh, recommendStop, scoreSeal, type SealInput, type SealScore, type Weights } from "./engine/seal";

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// ------------------------------------------------------------------ weights
export async function getWeights(): Promise<Weights> {
  const row = await q1<{ weights: Partial<Weights> }>("select weights from ast.risk_config where id=1");
  return { ...DEFAULT_WEIGHTS, ...(row?.weights ?? {}) };
}
export async function saveWeights(userId: string, w: Record<string, unknown>, reason: string) {
  const clean = {} as Weights;
  for (const k of FACTORS) {
    const v = Number(w[k]);
    if (!Number.isInteger(v) || v < 0 || v > 5) throw new HttpError(422, `${FACTOR_LABEL[k]}: the weight must be a whole number from 0 to 5`, "validation");
    clean[k] = v;
  }
  if (Object.values(clean).every((v) => v === 0)) throw new HttpError(422, "At least one factor needs a weight above 0", "validation");
  if (reason.trim().length < 5) throw new HttpError(422, "Say why the weights change", "validation");
  await tx({ userId, reason }, (c) => qc(c, `insert into ast.risk_config(id,weights,updated_by) values (1,$1,$2) on conflict (id) do update set weights=excluded.weights, updated_by=excluded.updated_by, updated_at=now()`, [JSON.stringify(clean), userId]));
  return clean;
}

// ------------------------------------------------------------------ inputs
export type Scored = {
  positionId: string; installationId: string; partId: string; partCode: string; lineId: string; lineCode: string; equipmentName: string; assembly: string; positionName: string;
  criticality: number; asOf: string; ageDays: number; nominalLifeDays: number; lastRating: number | null; input: SealInput; rates: { runPerDay: number | null; cipPerDay: number | null };
  result: SealScore;
};

/** Everything the engine needs, as it was known on each given date. Used live (today) and for the backtest (past dates). */
export async function loadInputs(items: { installationId: string; asOf: string }[], w: Weights): Promise<Scored[]> {
  if (!items.length) return [];
  const rows = await q(
    `with want as (select * from unnest($1::uuid[], $2::date[]) as t(installation_id, as_of)),
     inst as (
       select w.as_of, i.id as installation_id, i.installed_on, i.position_id, pt.id as part_id, pt.code as part_code, t.nominal_life_days, t.nominal_run_hours, t.nominal_cip_cycles, t.max_temp_c, t.max_pressure_bar,
              p.criticality, p.equipment_id, p.name as position_name, p.assembly, e.name as equipment_name, e.line_id, l.code as line_code
       from want w join ast.installation i on i.id = w.installation_id join ast.part pt on pt.id = i.part_id join ast.part_type t on t.id = pt.part_type_id
       join ast.position p on p.id = i.position_id join ast.equipment e on e.id = p.equipment_id join cfg.line l on l.id = e.line_id)
     select inst.*, (inst.as_of - inst.installed_on) as age_days,
            x.run_hours, x.cip, x.weeks, x.weeks_temp, x.weeks_press, r.rating as last_rating, r.inspected_on as last_inspected,
            h.failures, h.prior, n.inc12, n.fb30, rt.run_rate, rt.cip_rate
     from inst
     left join lateral (select sum(e.run_hours) as run_hours, sum(e.cip_cycles) as cip, count(*) as weeks,
         count(*) filter (where inst.max_temp_c is not null and e.max_temp_c > inst.max_temp_c) as weeks_temp,
         count(*) filter (where inst.max_pressure_bar is not null and e.max_pressure_bar > inst.max_pressure_bar) as weeks_press
       from ast.exposure e where e.equipment_id = inst.equipment_id and e.week_start + 6 >= inst.installed_on and e.week_start <= inst.as_of) x on true
     left join lateral (select rating, inspected_on from ast.inspection where installation_id = inst.installation_id and inspected_on <= inst.as_of order by inspected_on desc, created_at desc limit 1) r on true
     left join lateral (select count(*) filter (where removal_reason = 'failure') as failures, count(*) as prior from ast.installation where position_id = inst.position_id and removed_on is not null and removed_on <= inst.as_of) h on true
     left join lateral (select count(*) filter (where occurred_on > inst.as_of - 365 and occurred_on <= inst.as_of) as inc12,
         coalesce(bool_or(kind = 'foreign_body' and occurred_on > inst.as_of - 30 and occurred_on <= inst.as_of), false) as fb30 from ast.incident where position_id = inst.position_id) n on true
     left join lateral (select sum(run_hours) / (count(*) * 7.0) as run_rate, sum(cip_cycles) / (count(*) * 7.0) as cip_rate
       from (select * from ast.exposure where equipment_id = inst.equipment_id and week_start <= inst.as_of order by week_start desc limit 8) z) rt on true`,
    [items.map((i) => i.installationId), items.map((i) => i.asOf)]);
  return rows.map((r) => {
    const weeks = Number(r.weeks ?? 0);
    const input: SealInput = {
      ageDays: Number(r.age_days), nominalLifeDays: r.nominal_life_days, criticality: r.criticality,
      runHours: weeks > 0 ? num(r.run_hours) : null, nominalRunHours: r.nominal_run_hours,
      cipCycles: weeks > 0 ? num(r.cip) : null, nominalCipCycles: r.nominal_cip_cycles,
      weeksExposed: weeks, weeksOverTemp: r.max_temp_c != null ? Number(r.weeks_temp ?? 0) : null, weeksOverPressure: r.max_pressure_bar != null ? Number(r.weeks_press ?? 0) : null,
      lastRating: r.last_rating, daysSinceInspection: r.last_inspected ? Math.round((Date.parse(r.as_of + "T00:00:00Z") - Date.parse(r.last_inspected + "T00:00:00Z")) / 86400000) : null,
      priorSeals: Number(r.prior ?? 0), priorFailures: Number(r.failures ?? 0), incidents12m: Number(r.inc12 ?? 0), foreignBody30d: !!r.fb30,
    };
    return {
      positionId: r.position_id, installationId: r.installation_id, partId: r.part_id, partCode: r.part_code, lineId: r.line_id, lineCode: r.line_code, equipmentName: r.equipment_name,
      assembly: r.assembly, positionName: r.position_name, criticality: r.criticality, asOf: r.as_of, ageDays: input.ageDays, nominalLifeDays: r.nominal_life_days, lastRating: r.last_rating, input,
      rates: { runPerDay: num(r.run_rate), cipPerDay: num(r.cip_rate) }, result: scoreSeal(input, w),
    };
  });
}

export async function scoreLive(): Promise<Scored[]> {
  const w = await getWeights();
  const open = await q<{ id: string }>(`select i.id from ast.installation i join ast.position p on p.id = i.position_id where i.removed_on is null and p.status = 'Active'`);
  const t = today();
  return loadInputs(open.map((o) => ({ installationId: o.id, asOf: t })), w);
}

export async function futureStops(lineId: string) {
  return q(`select id, start_on, end_on, kind, note from ast.planned_stop where line_id=$1 and status='Planned' and end_on >= current_date order by start_on`, [lineId]);
}

export function projectionFor(s: Scored, w: Weights) {
  return projectHigh(s.input, s.rates, w);
}

const topFactors = (r: SealScore) => [...r.factors].filter((f) => f.points > 0).sort((a, b) => b.points - a.points).slice(0, 3);
export function summarise(s: Scored, projDays: number | null): string {
  const top = topFactors(s.result).map((f) => `${f.label.toLowerCase()} (${f.note})`).join("; ");
  const fl = s.result.floors.map((f) => f.text).join(". ");
  const when = projDays === 0 ? "High now" : projDays == null ? "not expected to reach High within a year" : `projected to reach High in about ${projDays} days`;
  return `Score ${s.result.score} (${s.result.level}), ${when}. Main factors: ${top || "none"}.${fl ? " " + fl + "." : ""}`;
}

// ------------------------------------------------------------------ the risk board
export async function riskBoard() {
  const w = await getWeights();
  const scored = await scoreLive();
  const stopsByLine = new Map<string, any[]>();
  const stops: Record<string, any[]> = {};
  for (const l of new Set(scored.map((s) => s.lineId))) { const st = await futureStops(l); stopsByLine.set(l, st); stops[scored.find((s) => s.lineId === l)!.lineCode] = st; }
  const alerts = await q(
    `select a.*, p.name as position_name, p.assembly, e.name as equipment_name, l.code as line_code, pt.code as part_code,
            s.start_on as stop_start, s.end_on as stop_end, s.kind as stop_kind
     from ast.alert a join ast.position p on p.id = a.position_id join ast.equipment e on e.id = p.equipment_id join cfg.line l on l.id = e.line_id
     join ast.installation i on i.id = a.installation_id join ast.part pt on pt.id = i.part_id left join ast.planned_stop s on s.id = a.planned_stop_id
     where a.state in ('New','Acknowledged','Planned','Deferred') or a.closed_at > now() - interval '30 days'
     order by (a.state in ('Done','Dismissed')), case a.level when 'High' then 0 when 'Medium' then 1 else 2 end, a.score desc`);
  const t = today();
  const ranked = scored.map((s) => {
    const proj = projectionFor(s, w);
    const rec = recommendStop(stopsByLine.get(s.lineId) as any[], t, proj);
    return { ...s, projectedDays: proj, projectedHighOn: proj == null ? null : addDays(t, proj), recommendedStop: rec };
  }).sort((a, b) => b.result.score - a.result.score);
  const counts = { High: 0, Medium: 0, Low: 0 } as Record<string, number>;
  ranked.forEach((r) => counts[r.result.level]++);
  const lastRun = await q1<{ computed_on: string }>("select max(computed_on) as computed_on from ast.risk_snapshot");
  return { weights: w, defaults: DEFAULT_WEIGHTS, factorLabels: FACTOR_LABEL, thresholds: { high: HIGH_AT, medium: MEDIUM_AT }, engineVersion: SEAL_ENGINE_VERSION, counts, ranked, alerts, stops, lastRefresh: lastRun?.computed_on ?? null };
}

export async function positionRisk(positionId: string) {
  const w = await getWeights();
  const inst = await q1<{ id: string; line_id: string }>(`select i.id, e.line_id from ast.installation i join ast.position p on p.id = i.position_id join ast.equipment e on e.id = p.equipment_id where i.position_id=$1 and i.removed_on is null`, [positionId]);
  if (!inst) return null;
  const [s] = await loadInputs([{ installationId: inst.id, asOf: today() }], w);
  const proj = projectionFor(s, w);
  const stops = await futureStops(inst.line_id);
  const alert = await q1(`select a.*, s.start_on as stop_start, s.end_on as stop_end, s.kind as stop_kind from ast.alert a left join ast.planned_stop s on s.id=a.planned_stop_id where a.position_id=$1 and a.state in ('New','Acknowledged','Planned','Deferred')`, [positionId]);
  const trend = await q(`select computed_on, score, level from ast.risk_snapshot where position_id=$1 order by computed_on desc limit 60`, [positionId]);
  return { ...s, projectedDays: proj, projectedHighOn: proj == null ? null : addDays(today(), proj), recommendedStop: recommendStop(stops as any[], today(), proj), summary: summarise(s, proj), alert, trend: trend.reverse(), weights: w };
}

// ------------------------------------------------------------------ refresh: score everything, store snapshots, raise and update alerts
export async function refreshRisk(userId: string | null) {
  const w = await getWeights();
  const scored = await scoreLive();
  const t = today();
  const res = { scored: scored.length, raised: 0, updated: 0, closedByReplacement: 0, reopened: 0 };
  await tx({ userId, reason: "Risk refresh" }, async (c) => {
    // alerts whose seal has since been replaced are done
    const closed = await qc(c, `update ast.alert a set state='Done', state_reason=coalesce(a.state_reason,'Seal replaced')
      where a.state in ('New','Acknowledged','Planned','Deferred') and not exists (select 1 from ast.installation i where i.id = a.installation_id and i.removed_on is null) returning a.id`);
    res.closedByReplacement = closed.length;
    for (const s of scored) {
      const proj = projectionFor(s, w);
      const text = summarise(s, proj);
      await qc(c, `insert into ast.risk_snapshot(position_id,installation_id,computed_on,score,level,projected_high_on,factors,engine_version) values ($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict (position_id, computed_on) do update set installation_id=excluded.installation_id, score=excluded.score, level=excluded.level, projected_high_on=excluded.projected_high_on, factors=excluded.factors, engine_version=excluded.engine_version`,
        [s.positionId, s.installationId, t, s.result.score, s.result.level, proj == null ? null : addDays(t, proj), JSON.stringify({ factors: s.result.factors, floors: s.result.floors, multiplier: s.result.multiplier, missing: s.result.missing }), SEAL_ENGINE_VERSION]);
      const projDate = proj == null ? null : addDays(t, proj);
      const needs = s.result.level === "High" || (proj != null && proj <= 45);
      const open = (await qc(c, `select id, state, defer_until from ast.alert where position_id=$1 and state in ('New','Acknowledged','Planned','Deferred')`, [s.positionId]))[0];
      if (open) {
        await qc(c, `update ast.alert set level=$2, score=$3, projected_high_on=$4, summary=$5 where id=$1`, [open.id, s.result.level, s.result.score, projDate, text]);
        if (open.state === "Deferred" && open.defer_until && open.defer_until <= t) { await qc(c, `update ast.alert set state='New', state_reason=null, defer_until=null where id=$1`, [open.id]); res.reopened++; }
        res.updated++;
      } else if (needs) {
        await qc(c, `insert into ast.alert(position_id,installation_id,level,score,projected_high_on,summary) values ($1,$2,$3,$4,$5,$6)`, [s.positionId, s.installationId, s.result.level, s.result.score, projDate, text]);
        res.raised++;
      }
    }
  });
  return res;
}

// ------------------------------------------------------------------ people handle alerts
export async function transitionAlert(userId: string, id: string, d: { to: string; reason?: string; stopId?: string; deferUntil?: string }) {
  const to = d.to;
  if (!["Acknowledged", "Planned", "Deferred", "Dismissed", "Done"].includes(to)) throw new HttpError(422, "Unknown alert state", "validation");
  return tx({ userId, reason: `Alert ${to.toLowerCase()}${d.reason ? `: ${d.reason}` : ""}` }, async (c) => {
    const a = (await qc(c, `select id, position_id from ast.alert where id=$1 for update`, [id]))[0];
    if (!a) throw new HttpError(404, "Alert not found", "not_found");
    if (to === "Planned") {
      const st = (await qc(c, `select s.id from ast.planned_stop s join ast.position p on p.id=$2 join ast.equipment e on e.id=p.equipment_id where s.id=$1 and s.line_id=e.line_id and s.status='Planned'`, [d.stopId ?? null, a.position_id]))[0];
      if (!st) throw new HttpError(422, "Choose a planned stop on the same line", "validation");
    }
    await qc(c, `update ast.alert set state=$2, planned_stop_id=case when $2='Planned' then $3::uuid else planned_stop_id end, state_reason=$4, defer_until=$5 where id=$1`,
      [id, to, d.stopId ?? null, d.reason?.trim() || null, to === "Deferred" ? d.deferUntil ?? null : null]);
    return { ok: true };
  });
}

// ------------------------------------------------------------------ backtest: would the score have warned in time?
export async function backtest(leadDays = 30) {
  const w = await getWeights();
  const closed = await q<{ id: string; removed_on: string; installed_on: string; removal_reason: string }>(
    `select id, removed_on, installed_on, removal_reason from ast.installation where removed_on is not null and removal_reason in ('failure','planned_replacement','inspection_finding') and removed_on - installed_on > $1 + 10`, [leadDays]);
  const scored = await loadInputs(closed.map((c) => ({ installationId: c.id, asOf: addDays(c.removed_on, -leadDays) })), w);
  const byId = new Map(closed.map((c) => [c.id, c]));
  const rows = scored.map((s) => {
    const c = byId.get(s.installationId)!;
    return { failed: c.removal_reason === "failure", score: s.result.score, level: s.result.level, ageRatio: s.ageDays / s.nominalLifeDays, positionId: s.positionId, partCode: s.partCode, removedOn: c.removed_on };
  });
  const fail = rows.filter((r) => r.failed), ok = rows.filter((r) => !r.failed);
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null);
  const tally = (list: typeof rows, f: (r: (typeof rows)[0]) => boolean) => list.filter(f).length;
  const engineHigh = (r: (typeof rows)[0]) => r.score >= HIGH_AT, engineMed = (r: (typeof rows)[0]) => r.score >= MEDIUM_AT, ageRule = (r: (typeof rows)[0]) => r.ageRatio >= 0.85;
  return {
    leadDays, failures: fail.length, others: ok.length,
    engine: { highOfFailures: tally(fail, engineHigh), mediumUpOfFailures: tally(fail, engineMed), highOfOthers: tally(ok, engineHigh), mediumUpOfOthers: tally(ok, engineMed) },
    ageOnly: { flaggedFailures: tally(fail, ageRule), flaggedOthers: tally(ok, ageRule) },
    pct: { failuresCaughtMedium: pct(tally(fail, engineMed), fail.length), falseAlarmsMedium: pct(tally(ok, engineMed), ok.length), ageCaught: pct(tally(fail, ageRule), fail.length), ageFalse: pct(tally(ok, ageRule), ok.length) },
    note: "Each seal is re-scored on the data as it stood 30 days before it came out. A failure counts as caught only if the score had warned by then. Seals replaced on schedule are expected to score Medium or High near the end, so flagging them agrees with the plan. With few failures this is a sanity check, not proof. The demo failures are synthetic and random, so on the demo data it says nothing about the real plant: run it on real history.",
  };
}

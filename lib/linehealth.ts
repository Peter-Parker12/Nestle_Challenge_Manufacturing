import { HttpError } from "./auth";
import { q, q1, qc, tx } from "./db";
import { H_FACTORS, HEALTH_ENGINE_VERSION, predictStop, scoreStation, type StationInput } from "./engine/health";
import { scoreLive } from "./risk";

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

export async function listFillers() {
  return q(`select e.id, e.code, e.name, l.code as line_code, l.name as line_name from ast.equipment e join cfg.line l on l.id=e.line_id where e.kind='filler' and e.status='Active' order by l.code`);
}

export type Action = { kind: "seal" | "predict" | "task" | "guide" | "setting" | "watch"; text: string; ref?: { type: string; id?: string; code?: string } };

/** The ranked health view of one filler: KPIs, then every station with score, evidence, prediction and next actions. */
export async function fillerHealth(equipmentId: string) {
  const eq = await q1(`select e.id, e.code, e.name, l.code as line_code, l.name as line_name from ast.equipment e join cfg.line l on l.id=e.line_id where e.id=$1 and e.kind='filler'`, [equipmentId]);
  if (!eq) throw new HttpError(404, "Filler not found", "not_found");
  const stations = await q(`select id, code, name, assembly from ops.station where equipment_id=$1 and status='Active' order by code`, [equipmentId]);

  const weekly = await q(
    `select station_id, (current_date - occurred_at::date) / 7 as wk, count(*)::int as n, count(*) filter (where severity='Fault')::int as f
     from ops.alarm_event where equipment_id=$1 and occurred_at >= current_date - 63 group by 1,2`, [equipmentId]);
  const top = await q(`select station_id, code, description, count(*)::int as n from ops.alarm_event where equipment_id=$1 and occurred_at >= current_date - 14 group by 1,2,3 order by n desc`, [equipmentId]);
  const down = await q(`select station_id, coalesce(sum(minutes),0)::int as m from ops.breakdown where equipment_id=$1 and started_at >= current_date - 14 group by 1`, [equipmentId]);
  const defects = await q(`select station_id, coalesce(sum(qty),0)::int as n from ops.defect where equipment_id=$1 and occurred_on >= current_date - 14 group by 1`, [equipmentId]);
  const overdue = await q(`select station_id, max(current_date - due_on)::int as d, count(*)::int as n, (array_agg(title order by due_on))[1] as title, (array_agg(id order by due_on))[1] as task_id from ops.maintenance_task where equipment_id=$1 and done_on is null and due_on < current_date group by 1`, [equipmentId]);
  const settings = await q(`select s.* from ops.setting s join ops.station st on st.id=s.station_id where st.equipment_id=$1`, [equipmentId]);
  const guides = await q(`select code, title, alarm_codes from ops.guide where status='Active'`);
  const pre = await q(
    `select (select count(*) from ops.alarm_event a where a.station_id=b.station_id and a.severity='Fault' and a.occurred_at >= b.started_at - interval '7 days' and a.occurred_at < b.started_at)::int as n
     from ops.breakdown b where b.equipment_id=$1 and b.station_id is not null`, [equipmentId]);
  const threshold = pre.length >= 2 ? median(pre.map((p) => p.n)) : null;

  const positions = await q(`select id, assembly from ast.position where equipment_id=$1 and status='Active'`, [equipmentId]);
  const seal = new Map((await scoreLive()).map((s) => [s.positionId, s]));

  const items = stations.map((st) => {
    const rows = weekly.filter((w) => w.station_id === st.id);
    const get = (i: number, k: "n" | "f") => rows.find((r) => Number(r.wk) === i)?.[k] ?? 0;
    const weeklyAlarms = Array.from({ length: 8 }, (_, i) => get(7 - i, "n"));       // oldest to newest
    const weeklyFaults = Array.from({ length: 8 }, (_, i) => get(7 - i, "f"));
    const usual = Array.from({ length: 8 }, (_, i) => get(i + 1, "n")).reduce((a, b) => a + b, 0) / 8;
    const ov = overdue.find((o) => o.station_id === st.id);
    const sealPos = positions.filter((p) => p.assembly && p.assembly === st.assembly).map((p) => seal.get(p.id)).filter(Boolean) as NonNullable<ReturnType<typeof seal.get>>[];
    const worst = sealPos.sort((a, b) => b.result.score - a.result.score)[0];
    const input: StationInput = {
      alarms7: weeklyAlarms[7], usualPerWeek: usual, weeklyAlarms, downtimeMin14: down.find((d) => d.station_id === st.id)?.m ?? 0,
      defects14: defects.find((d) => d.station_id === st.id)?.n ?? 0, overdueDays: ov?.d ?? 0, sealScore: worst ? worst.result.score : null,
    };
    const result = scoreStation(input);
    const prediction = predictStop(weeklyFaults, threshold);
    const topAlarm = top.find((t) => t.station_id === st.id);
    const guide = topAlarm ? guides.find((g) => (g.alarm_codes as string[]).includes(topAlarm.code)) : null;
    const drift = settings.filter((s) => s.station_id === st.id).map((s) => {
      const half = (Number(s.max_value) - Number(s.min_value)) / 2, cur = Number(s.current_value), tgt = Number(s.target);
      const out = cur < Number(s.min_value) || cur > Number(s.max_value);
      return { settingId: s.id, code: s.code, name: s.name, unit: s.unit, current: cur, target: tgt, min: Number(s.min_value), max: Number(s.max_value), outside: out, drifted: Math.abs(cur - tgt) > 0.5 * half };
    }).filter((d) => d.drifted || d.outside);

    const actions: Action[] = [];
    if (worst && worst.result.score >= 70) actions.push({ kind: "seal", text: `Inspect and replace the ${worst.positionName.toLowerCase()} (${worst.partCode}) at the next maintenance window: seal risk is ${worst.result.level} (${worst.result.score}).`, ref: { type: "position", id: worst.positionId } });
    if (prediction.status === "at_or_above" || (prediction.status === "rising" && (prediction.weeks ?? 9) <= 3)) actions.push({ kind: "predict", text: `Plan a check before the next stop: ${prediction.text}` });
    if (ov) actions.push({ kind: "task", text: `Do the overdue task "${ov.title}" (${ov.d} days overdue).`, ref: { type: "task", id: ov.task_id } });
    if (guide && topAlarm && result.level !== "Low") actions.push({ kind: "guide", text: `Follow guide ${guide.code}, ${guide.title}, for the repeating alarm ${topAlarm.code}.`, ref: { type: "guide", code: guide.code } });
    for (const d of drift) actions.push({ kind: "setting", text: d.outside ? `${d.name} is ${d.current} ${d.unit}, outside the approved ${d.min} to ${d.max}. A person should bring it back.` : `${d.name} has drifted to ${d.current} ${d.unit}; the target is ${d.target}. A person can return it to the target.`, ref: { type: "setting", id: d.settingId } });
    if (!actions.length) actions.push({ kind: "watch", text: "No action needed. Keep monitoring." });

    return {
      stationId: st.id, code: st.code, name: st.name, assembly: st.assembly, score: result.score, level: result.level, factors: result.factors, prediction,
      topAlarm: topAlarm ? { code: topAlarm.code, description: topAlarm.description, count: topAlarm.n } : null, weeklyAlarms, weeklyFaults,
      seal: worst ? { positionId: worst.positionId, name: worst.positionName, partCode: worst.partCode, score: worst.result.score, level: worst.result.level } : null,
      drift, actions,
    };
  }).sort((a, b) => b.score - a.score);

  const k = await q1(
    `select round(avg(eups) filter (where day >= current_date - 6), 1) as eups7, round(avg(eups) filter (where day < current_date - 6 and day >= current_date - 34), 1) as eups_base,
            round(avg(speed_pct) filter (where day >= current_date - 6), 1) as speed7, round(avg(speed_pct) filter (where day < current_date - 6 and day >= current_date - 34), 1) as speed_base,
            round(sum(unplanned_downtime_min) filter (where day >= current_date - 6)) as down7, round(sum(unplanned_downtime_min) filter (where day < current_date - 6 and day >= current_date - 34) / 4.0) as down_base,
            round(sum(material_loss_kg) filter (where day >= current_date - 6), 1) as loss7, round(sum(material_loss_kg) filter (where day < current_date - 6 and day >= current_date - 34) / 4.0, 1) as loss_base
     from ops.kpi_daily where equipment_id=$1`, [equipmentId]);
  return { filler: eq, kpis: k, threshold, stations: items, engineVersion: HEALTH_ENGINE_VERSION, factors: H_FACTORS };
}

export async function stationDetail(stationId: string) {
  const st = await q1(`select s.*, e.id as equipment_id, e.name as equipment_name, l.code as line_code from ops.station s join ast.equipment e on e.id=s.equipment_id join cfg.line l on l.id=e.line_id where s.id=$1`, [stationId]);
  if (!st) throw new HttpError(404, "Station not found", "not_found");
  const health = (await fillerHealth(st.equipment_id)).stations.find((s) => s.stationId === stationId)!;
  const [alarms, byCode, breakdowns, defects, tasks, settings, corrections] = await Promise.all([
    q(`select occurred_at, code, description, severity, duration_s from ops.alarm_event where station_id=$1 and occurred_at >= current_date - 30 order by occurred_at desc limit 60`, [stationId]),
    q(`select code, description, count(*)::int as n, count(*) filter (where severity='Fault')::int as faults, max(occurred_at) as last_at from ops.alarm_event where station_id=$1 and occurred_at >= current_date - 30 group by 1,2 order by n desc`, [stationId]),
    q(`select started_at, minutes, cause, fix from ops.breakdown where station_id=$1 order by started_at desc limit 20`, [stationId]),
    q(`select occurred_on, kind, qty from ops.defect where station_id=$1 and occurred_on >= current_date - 30 order by occurred_on desc`, [stationId]),
    q(`select id, kind, title, due_on, done_on, note, (done_on is null and due_on < current_date) as overdue from ops.maintenance_task where station_id=$1 order by (done_on is null) desc, due_on desc limit 12`, [stationId]),
    q(`select id, code, name, unit, target, min_value, max_value, current_value, updated_at from ops.setting where station_id=$1 order by code`, [stationId]),
    q(`select c.applied_at, c.from_value, c.to_value, c.reason, s.name as setting, u.name as by from ops.correction c join ops.setting s on s.id=c.setting_id left join cfg.app_user u on u.id=c.applied_by where s.station_id=$1 order by c.applied_at desc limit 10`, [stationId]),
  ]);
  const codes = byCode.map((b) => b.code);
  const guides = codes.length ? await q(`select code, title, alarm_codes, steps, source from ops.guide where status='Active' and alarm_codes && $1::text[]`, [codes]) : [];
  return { station: st, health, alarms, byCode, breakdowns, defects, tasks, settings, corrections, guides };
}

export async function recordCorrection(userId: string, settingId: string, toValue: number, reason: string) {
  if (!Number.isFinite(toValue)) throw new HttpError(422, "Enter the new value", "validation");
  return tx({ userId, reason: "Setting corrected by a person" }, async (c) => {
    const s = (await qc(c, `select current_value from ops.setting where id=$1`, [settingId]))[0];
    if (!s) throw new HttpError(404, "Setting not found", "not_found");
    return (await qc(c, `insert into ops.correction(setting_id,from_value,to_value,reason,applied_by) values ($1,$2,$3,$4,$5) returning id`, [settingId, s.current_value, toValue, reason, userId]))[0];
  });
}

// ------------------------------------------------------------------ guides
export async function listGuides() { return q(`select id, code, title, alarm_codes, keywords, jsonb_array_length(steps) as steps, source, status from ops.guide order by code`); }
export async function getGuide(code: string) {
  const g = await q1(`select id, code, title, alarm_codes, keywords, steps, source, status from ops.guide where code=$1`, [code]);
  if (!g) throw new HttpError(404, "Guide not found", "not_found");
  return g;
}
export async function createGuide(userId: string, d: { code: string; title: string; alarmCodes: string[]; keywords: string[]; steps: string[]; source?: string }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(d.code)) throw new HttpError(422, "Code must be 2 to 40 characters: letters, digits, dot, dash, underscore", "validation");
  const steps = d.steps.map((s) => s.trim()).filter(Boolean);
  if (!steps.length) throw new HttpError(422, "Add at least one step", "validation");
  return tx({ userId, reason: "Create guide" }, async (c) => (await qc(c,
    `insert into ops.guide(code,title,alarm_codes,keywords,steps,source,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [d.code, d.title.trim(), d.alarmCodes, d.keywords, JSON.stringify(steps.map((text, i) => ({ n: i + 1, text }))), d.source?.trim() || null, userId]))[0]);
}

/** What the filler alarms say about one seal position (same assembly), for the seal page. */
export async function alarmsForPosition(positionId: string) {
  return q(
    `select st.id as station_id, st.name as station, count(a.*)::int as n14, count(a.*) filter (where a.severity='Fault')::int as faults14,
            (select code from ops.alarm_event x where x.station_id=st.id and x.occurred_at >= current_date-14 group by code order by count(*) desc limit 1) as top_code
     from ast.position p join ops.station st on st.equipment_id=p.equipment_id and st.assembly=p.assembly
     left join ops.alarm_event a on a.station_id=st.id and a.occurred_at >= current_date - 14 where p.id=$1 group by st.id, st.name`, [positionId]);
}

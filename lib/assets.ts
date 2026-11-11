import { HttpError } from "./auth";
import { q, q1, qc, tx } from "./db";

/**
 * Asset model: Line > Equipment > Position > Seal (part). Phase 1 of Line Intelligence.
 * Rules live in migration 004 as well (one open seal per position, no overlap, append-only history, retire never delete).
 */

export const REMOVAL_REASONS = ["planned_replacement", "failure", "inspection_finding", "upgrade", "other"] as const;
export const INCIDENT_KINDS = ["foreign_body", "leak", "seal_failure", "contamination_risk"] as const;
export const SEVERITIES = ["Minor", "Major", "Critical"] as const;
export const STOP_KINDS = ["CIP", "changeover", "maintenance", "shutdown"] as const;
export const EQUIPMENT_KINDS = ["filler", "homogeniser", "uht", "valve_cluster", "pump", "tank", "other"] as const;
export const RATING_LABEL = ["", "Like new", "Light wear", "Visible wear", "Damaged", "Failed"] as const;

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s: unknown): s is string => typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const today = () => new Date().toISOString().slice(0, 10);

export function checkCode(code: string, what: string) {
  if (!CODE_RE.test(code)) throw new HttpError(422, `${what} code must be 1 to 40 characters: letters, digits, dot, dash, underscore`, "validation");
}
function needDate(s: unknown, label: string): string {
  if (!isDate(s)) throw new HttpError(422, `${label} must be a date (YYYY-MM-DD)`, "validation");
  return s;
}

// ------------------------------------------------------------------ reads
export async function plantOverview() {
  const positions = await q(`select * from ast.v_position where position_status='Active' order by line_code, equipment_code, assembly, position_code`);
  const lines = await q(`select id, code, name from cfg.line order by code`);
  const stops = await q(
    `select s.id, s.start_on, s.end_on, s.kind, s.note, s.status, l.code as line_code from ast.planned_stop s join cfg.line l on l.id=s.line_id
     where s.status='Planned' and s.end_on >= current_date order by s.start_on limit 8`);
  const k = (await q1(
    `select count(*)::int as positions,
            count(*) filter (where installation_id is not null)::int as with_seal,
            round(avg(age_days) filter (where installation_id is not null))::int as avg_age,
            count(*) filter (where age_days > nominal_life_days)::int as beyond_nominal,
            count(*) filter (where age_days > nominal_life_days * 0.85 and age_days <= nominal_life_days)::int as nearing_nominal,
            count(*) filter (where last_rating >= 4)::int as rated_poor,
            coalesce(sum(incidents_12m),0)::int as incidents_12m
     from ast.v_position where position_status='Active'`))!;
  return { lines, positions, stops, kpis: k };
}

export async function getPosition(id: string) {
  const pos = await q1(`select * from ast.v_position where position_id=$1`, [id]);
  if (!pos) throw new HttpError(404, "Position not found", "not_found");
  const history = await q(
    `select i.id as installation_id, i.installed_on, i.removed_on, i.removal_reason, i.note,
            pt.id as part_id, pt.code as part_code, t.code as type_code, t.name as type_name, t.material, t.nominal_life_days,
            coalesce(i.removed_on, current_date) - i.installed_on as days_in_service,
            (select count(*)::int from ast.inspection r where r.installation_id=i.id) as inspections,
            (select max(r.rating) from ast.inspection r where r.installation_id=i.id) as worst_rating
     from ast.installation i join ast.part pt on pt.id=i.part_id join ast.part_type t on t.id=pt.part_type_id
     where i.position_id=$1 order by i.installed_on desc, i.removed_on desc nulls first`, [id]);
  const incidents = await q(
    `select n.id, n.occurred_on, n.kind, n.severity, n.description, pt.code as part_code, u.name as reported_by
     from ast.incident n left join ast.installation i on i.id=n.installation_id left join ast.part pt on pt.id=i.part_id left join cfg.app_user u on u.id=n.reported_by
     where n.position_id=$1 order by n.occurred_on desc`, [id]);
  const types = await q(`select id, code, name, material, nominal_life_days from ast.part_type where status='Active' order by code`);
  return { position: pos, history, incidents, partTypes: types };
}

export async function getPart(id: string) {
  const part = await q1(
    `select pt.id, pt.code, pt.lot, pt.received_on, pt.status, t.code as type_code, t.name as type_name, t.material, t.supplier, t.nominal_life_days, t.spec_note
     from ast.part pt join ast.part_type t on t.id=pt.part_type_id where pt.id=$1`, [id]);
  if (!part) throw new HttpError(404, "Part not found", "not_found");
  const installs = await q(
    `select i.id, i.installed_on, i.removed_on, i.removal_reason, i.note, p.id as position_id, p.name as position_name, p.assembly, p.criticality,
            e.name as equipment_name, l.code as line_code, u.name as installed_by
     from ast.installation i join ast.position p on p.id=i.position_id join ast.equipment e on e.id=p.equipment_id join cfg.line l on l.id=e.line_id
     left join cfg.app_user u on u.id=i.installed_by where i.part_id=$1 order by i.installed_on`, [id]);
  const ids = installs.map((i) => i.id);
  const inspections = ids.length ? await q(
    `select r.id, r.installation_id, r.inspected_on, r.rating, r.finding, u.name as inspector from ast.inspection r left join cfg.app_user u on u.id=r.inspector_id
     where r.installation_id = any($1::uuid[]) order by r.inspected_on`, [ids]) : [];
  const incidents = ids.length ? await q(
    `select n.id, n.installation_id, n.occurred_on, n.kind, n.severity, n.description from ast.incident n where n.installation_id = any($1::uuid[]) order by n.occurred_on`, [ids]) : [];

  // one chronological passport
  type Ev = { date: string; kind: string; title: string; detail?: string; tone?: string; rating?: number };
  const events: Ev[] = [];
  if (part.received_on) events.push({ date: part.received_on, kind: "received", title: "Received", detail: part.lot ? `Lot ${part.lot}` : undefined });
  for (const i of installs) {
    events.push({ date: i.installed_on, kind: "installed", title: `Installed at ${i.assembly}, ${i.position_name}`, detail: `${i.line_code} · ${i.equipment_name}${i.installed_by ? ` · by ${i.installed_by}` : ""}` });
    if (i.removed_on) events.push({ date: i.removed_on, kind: "removed", title: `Removed (${String(i.removal_reason).replace(/_/g, " ")})`, detail: i.note ?? undefined, tone: i.removal_reason === "failure" ? "bad" : undefined });
  }
  for (const r of inspections) events.push({ date: r.inspected_on, kind: "inspection", title: `Inspected: ${RATING_LABEL[r.rating]}`, detail: [r.finding, r.inspector && `by ${r.inspector}`].filter(Boolean).join(" · ") || undefined, tone: r.rating >= 4 ? "bad" : r.rating === 3 ? "warn" : undefined, rating: r.rating });
  for (const n of incidents) events.push({ date: n.occurred_on, kind: "incident", title: `${String(n.kind).replace(/_/g, " ")} (${n.severity})`, detail: n.description ?? undefined, tone: "bad" });
  const order: Record<string, number> = { received: 0, installed: 1, inspection: 2, incident: 3, removed: 4 };
  events.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
  return { part, installs, events };
}

export async function listParts(search?: string, status?: string) {
  return q(
    `select pt.id, pt.code, pt.lot, pt.status, t.code as type_code, t.material, t.nominal_life_days,
            v.line_code, v.position_name, v.assembly, v.equipment_name, v.installed_on, v.age_days,
            (select count(*)::int from ast.installation i where i.part_id=pt.id) as installs
     from ast.part pt join ast.part_type t on t.id=pt.part_type_id
     left join ast.v_position v on v.part_id=pt.id
     where ($1::text is null or pt.code ilike '%'||$1||'%' or v.position_name ilike '%'||$1||'%' or v.assembly ilike '%'||$1||'%')
       and ($2::text is null or pt.status=$2)
     order by pt.status='Installed' desc, pt.code limit 300`, [search || null, status || null]);
}

export async function listStops(includePast = false) {
  return q(
    `select s.id, s.start_on, s.end_on, s.kind, s.note, s.status, l.code as line_code, u.name as created_by
     from ast.planned_stop s join cfg.line l on l.id=s.line_id left join cfg.app_user u on u.id=s.created_by
     where ($1 or s.end_on >= current_date - 14) order by s.start_on desc limit 200`, [includePast]);
}

export async function setupLists() {
  const lines = await q(`select id, code, name from cfg.line order by code`);
  const equipment = await q(
    `select e.id, e.code, e.name, e.kind, e.status, l.code as line_code, (select count(*)::int from ast.position p where p.equipment_id=e.id and p.status='Active') as positions
     from ast.equipment e join cfg.line l on l.id=e.line_id order by l.code, e.code`);
  const partTypes = await q(`select id, code, name, material, supplier, nominal_life_days, status, (select count(*)::int from ast.part p where p.part_type_id=t.id) as parts from ast.part_type t order by code`);
  return { lines, equipment, partTypes };
}

// ------------------------------------------------------------------ writes
export async function createEquipment(userId: string, d: { lineId: string; code: string; name: string; kind: string }) {
  checkCode(d.code, "Equipment");
  if (!EQUIPMENT_KINDS.includes(d.kind as any)) throw new HttpError(422, "Unknown equipment kind", "validation");
  return tx({ userId, reason: "Create equipment" }, async (c) =>
    (await qc(c, `insert into ast.equipment(line_id,code,name,kind) values ($1,$2,$3,$4) returning id`, [d.lineId, d.code, d.name.trim(), d.kind]))[0]);
}

export async function createPosition(userId: string, d: { equipmentId: string; code: string; name: string; assembly: string; sealFunction?: string; criticality: number }) {
  checkCode(d.code, "Position");
  return tx({ userId, reason: "Create position" }, async (c) =>
    (await qc(c, `insert into ast.position(equipment_id,code,name,assembly,seal_function,criticality) values ($1,$2,$3,$4,$5,$6) returning id`,
      [d.equipmentId, d.code, d.name.trim(), d.assembly.trim(), d.sealFunction?.trim() || null, d.criticality]))[0]);
}

export async function retirePosition(userId: string, id: string, reason: string) {
  return tx({ userId, reason }, async (c) => { await qc(c, `update ast.position set status='Retired' where id=$1`, [id]); return { ok: true }; });
}

export async function createPartType(userId: string, d: { code: string; name: string; material: string; supplier?: string; nominalLifeDays: number; specNote?: string }) {
  checkCode(d.code, "Part type");
  return tx({ userId, reason: "Create part type" }, async (c) =>
    (await qc(c, `insert into ast.part_type(code,name,material,supplier,nominal_life_days,spec_note) values ($1,$2,$3,$4,$5,$6) returning id`,
      [d.code, d.name.trim(), d.material.trim(), d.supplier?.trim() || null, d.nominalLifeDays, d.specNote?.trim() || null]))[0]);
}

/** Remove the current seal (if any) and install a new one, in one transaction. */
export async function replaceSeal(userId: string, d: {
  positionId: string; partCode: string; partTypeId: string; lot?: string; installedOn: string;
  removalReason?: string; note?: string;
}) {
  checkCode(d.partCode, "Part");
  needDate(d.installedOn, "Install date");
  if (d.installedOn > today()) throw new HttpError(422, "Install date cannot be in the future", "validation");
  return tx({ userId, reason: d.removalReason ? `Seal replaced (${d.removalReason})` : "Seal installed" }, async (c) => {
    const open = (await qc(c, `select id from ast.installation where position_id=$1 and removed_on is null for update`, [d.positionId]))[0];
    if (open) {
      if (!d.removalReason || !REMOVAL_REASONS.includes(d.removalReason as any)) throw new HttpError(422, "Choose why the current seal is removed", "validation");
      await qc(c, `update ast.installation set removed_on=$2, removal_reason=$3, note=coalesce($4,note) where id=$1`, [open.id, d.installedOn, d.removalReason, d.note ?? null]);
    }
    const part = (await qc(c, `insert into ast.part(code,part_type_id,lot,received_on) values ($1,$2,$3,null) returning id`, [d.partCode, d.partTypeId, d.lot?.trim() || null]))[0];
    const inst = (await qc(c, `insert into ast.installation(part_id,position_id,installed_on,installed_by,note) values ($1,$2,$3,$4,$5) returning id`,
      [part.id, d.positionId, d.installedOn, userId, d.removalReason ? null : d.note ?? null]))[0];
    return { partId: part.id, installationId: inst.id };
  });
}

export async function recordInspection(userId: string, d: { positionId: string; inspectedOn: string; rating: number; finding?: string }) {
  needDate(d.inspectedOn, "Inspection date");
  return tx({ userId, reason: "Inspection" }, async (c) => {
    const open = (await qc(c, `select id from ast.installation where position_id=$1 and removed_on is null`, [d.positionId]))[0];
    if (!open) throw new HttpError(409, "There is no seal installed at this position to inspect", "rule_violation");
    return (await qc(c, `insert into ast.inspection(installation_id,inspected_on,rating,finding,inspector_id) values ($1,$2,$3,$4,$5) returning id`,
      [open.id, d.inspectedOn, d.rating, d.finding?.trim() || null, userId]))[0];
  });
}

export async function recordIncident(userId: string, d: { positionId: string; occurredOn: string; kind: string; severity: string; description?: string }) {
  needDate(d.occurredOn, "Incident date");
  if (d.occurredOn > today()) throw new HttpError(422, "Incident date cannot be in the future", "validation");
  return tx({ userId, reason: "Incident" }, async (c) => {
    // link to the seal that was in the position on that date, when there is one
    const inst = (await qc(c, `select id from ast.installation where position_id=$1 and installed_on <= $2 and (removed_on is null or removed_on >= $2) order by installed_on desc limit 1`, [d.positionId, d.occurredOn]))[0];
    return (await qc(c, `insert into ast.incident(position_id,installation_id,occurred_on,kind,severity,description,reported_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [d.positionId, inst?.id ?? null, d.occurredOn, d.kind, d.severity, d.description?.trim() || null, userId]))[0];
  });
}

export async function createStop(userId: string, d: { lineId: string; startOn: string; endOn: string; kind: string; note?: string }) {
  needDate(d.startOn, "Start date"); needDate(d.endOn, "End date");
  if (d.endOn < d.startOn) throw new HttpError(422, "The end date is before the start date", "validation");
  return tx({ userId, reason: "Planned stop" }, async (c) =>
    (await qc(c, `insert into ast.planned_stop(line_id,start_on,end_on,kind,note,created_by) values ($1,$2,$3,$4,$5,$6) returning id`, [d.lineId, d.startOn, d.endOn, d.kind, d.note?.trim() || null, userId]))[0]);
}
export async function setStopStatus(userId: string, id: string, status: "Done" | "Cancelled") {
  return tx({ userId, reason: `Stop marked ${status}` }, async (c) => { await qc(c, `update ast.planned_stop set status=$2 where id=$1`, [id, status]); return { ok: true }; });
}

import { HttpError } from "./auth";
import { parseCsv, toCsv } from "./csv";
import { q, qc, tx } from "./db";
import { EQUIPMENT_KINDS, REMOVAL_REASONS, checkCode, isDate } from "./assets";

/**
 * Import of seal and position history: one row per seal installation.
 * Check first (nothing is written), then commit in one transaction. New positions only: a position that already has history is rejected.
 */
export const ASSET_COLUMNS = [
  "line_code", "equipment_code", "equipment_name", "equipment_kind", "assembly", "position_code", "position_name", "criticality",
  "part_type_code", "part_code", "lot", "installed_on", "removed_on", "removal_reason",
] as const;

type Row = Record<(typeof ASSET_COLUMNS)[number], string> & { _row: number };
export type AssetCheck = {
  ok: boolean;
  errors: { row: number; message: string }[];
  warnings: string[];
  summary: { rows: number; equipment: number; positions: number; parts: number; openSeals: number };
};

export function assetTemplate() {
  return toCsv([
    [...ASSET_COLUMNS],
    ["L3", "FL", "Filler", "filler", "Filling valve 1", "V1-PLUG", "Plug seal", "5", "EPDM-FV", "S-EPDM-FV-90001", "LOT-2601", "2026-02-10", "2026-08-05", "planned_replacement"],
    ["L3", "FL", "Filler", "filler", "Filling valve 1", "V1-PLUG", "Plug seal", "5", "EPDM-FV", "S-EPDM-FV-90002", "LOT-2608", "2026-08-05", "", ""],
  ]);
}

export async function checkAssetCsv(text: string): Promise<{ check: AssetCheck; rows: Row[] }> {
  const errors: AssetCheck["errors"] = [];
  const warnings: string[] = [];
  let table: string[][];
  try { table = parseCsv(text); } catch (e: any) { throw new HttpError(422, e.message, "validation"); }
  if (table.length < 2) throw new HttpError(422, "The file has no data rows", "validation");
  const head = table[0].map((h) => h.trim().toLowerCase());
  const missing = ASSET_COLUMNS.filter((c) => !head.includes(c));
  if (missing.length) throw new HttpError(422, `Missing columns: ${missing.join(", ")}`, "validation");
  if (table.length > 5001) throw new HttpError(422, "More than 5000 rows. Split the file", "validation");
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const rows: Row[] = table.slice(1).map((r, i) => {
    const o: any = { _row: i + 2 };
    for (const c of ASSET_COLUMNS) o[c] = (r[idx[c]] ?? "").trim();
    return o;
  });

  const lines = new Map((await q(`select id, code from cfg.line`)).map((l) => [l.code, l.id as string]));
  const types = new Set((await q(`select code from ast.part_type where status='Active'`)).map((t) => t.code as string));
  const existingParts = new Set((await q(`select code from ast.part`)).map((t) => t.code as string));
  const existingPositions = new Set((await q(`select l.code||'/'||e.code||'/'||p.code as k from ast.position p join ast.equipment e on e.id=p.equipment_id join cfg.line l on l.id=e.line_id join ast.installation i on i.position_id=p.id`)).map((t) => t.k as string));
  const todayStr = new Date().toISOString().slice(0, 10);
  const err = (row: number, message: string) => errors.push({ row, message });

  const seenParts = new Set<string>();
  const posInfo = new Map<string, Row>();
  const eqInfo = new Map<string, Row>();
  const byPos = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.line_code}/${r.equipment_code}/${r.position_code}`;
    if (!lines.has(r.line_code)) err(r._row, `Unknown line '${r.line_code}'. Lines are set up in the plant, not by import`);
    for (const [col, label] of [["equipment_code", "Equipment code"], ["position_code", "Position code"], ["part_code", "Part code"]] as const) {
      try { checkCode(r[col], label); } catch (e: any) { err(r._row, e.message); }
    }
    if (!r.equipment_name || !r.position_name || !r.assembly) err(r._row, "equipment_name, assembly and position_name are required");
    if (!EQUIPMENT_KINDS.includes(r.equipment_kind as any)) err(r._row, `equipment_kind must be one of ${EQUIPMENT_KINDS.join(", ")}`);
    const crit = Number(r.criticality);
    if (!Number.isInteger(crit) || crit < 1 || crit > 5) err(r._row, "criticality must be a whole number from 1 to 5");
    if (!types.has(r.part_type_code)) err(r._row, `Unknown part type '${r.part_type_code}'. Add it under Plant setup first`);
    if (!isDate(r.installed_on)) err(r._row, "installed_on must be a date (YYYY-MM-DD)");
    else if (r.installed_on > todayStr) err(r._row, "installed_on is in the future");
    if (r.removed_on) {
      if (!isDate(r.removed_on)) err(r._row, "removed_on must be a date (YYYY-MM-DD)");
      else if (isDate(r.installed_on) && r.removed_on < r.installed_on) err(r._row, "removed_on is before installed_on");
      else if (r.removed_on > todayStr) err(r._row, "removed_on is in the future");
      if (!REMOVAL_REASONS.includes(r.removal_reason as any)) err(r._row, `removal_reason must be one of ${REMOVAL_REASONS.join(", ")}`);
    } else if (r.removal_reason) err(r._row, "removal_reason given but removed_on is empty");
    if (seenParts.has(r.part_code)) err(r._row, `Part ${r.part_code} appears twice in the file`);
    seenParts.add(r.part_code);
    if (existingParts.has(r.part_code)) err(r._row, `Part ${r.part_code} already exists in the system`);
    if (existingPositions.has(key)) err(r._row, `Position ${key} already has history. This import loads new positions only`);
    const p0 = posInfo.get(key);
    if (p0 && (p0.position_name !== r.position_name || p0.assembly !== r.assembly || p0.criticality !== r.criticality)) err(r._row, `Position ${key} is described differently in row ${p0._row}`);
    else if (!p0) posInfo.set(key, r);
    const ek = `${r.line_code}/${r.equipment_code}`;
    const e0 = eqInfo.get(ek);
    if (e0 && (e0.equipment_name !== r.equipment_name || e0.equipment_kind !== r.equipment_kind)) err(r._row, `Equipment ${ek} is described differently in row ${e0._row}`);
    else if (!e0) eqInfo.set(ek, r);
    byPos.set(key, [...(byPos.get(key) ?? []), r]);
  }
  for (const [key, list] of byPos) {
    const sorted = [...list].sort((a, b) => a.installed_on.localeCompare(b.installed_on));
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      if (!cur.removed_on && i < sorted.length - 1) err(cur._row, `Position ${key}: this seal is still installed but a later one is listed`);
      if (i > 0 && sorted[i - 1].removed_on && cur.installed_on < sorted[i - 1].removed_on) err(cur._row, `Position ${key}: overlaps the previous seal (row ${sorted[i - 1]._row})`);
    }
  }
  const openSeals = rows.filter((r) => !r.removed_on).length;
  const noSeal = [...byPos.values()].filter((l) => l.every((r) => r.removed_on)).length;
  if (noSeal) warnings.push(`${noSeal} position(s) end with a removed seal and no current seal. They will show as empty until a seal is installed`);
  const summary = { rows: rows.length, equipment: eqInfo.size, positions: posInfo.size, parts: rows.length, openSeals };
  return { check: { ok: errors.length === 0, errors: errors.slice(0, 200), warnings, summary }, rows };
}

export async function commitAssetCsv(userId: string, text: string) {
  const { check, rows } = await checkAssetCsv(text);
  if (!check.ok) throw new HttpError(422, `The file has ${check.errors.length} problem(s). Fix them and check again`, "validation");
  const lines = new Map((await q(`select id, code from cfg.line`)).map((l) => [l.code, l.id as string]));
  const types = new Map((await q(`select id, code from ast.part_type`)).map((t) => [t.code, t.id as string]));
  const ordered = [...rows].sort((a, b) => a.installed_on.localeCompare(b.installed_on) || a._row - b._row);
  let created = { equipment: 0, positions: 0, parts: 0 };
  await tx({ userId, reason: "Asset history import" }, async (c) => {
    const eq = new Map<string, string>();
    const pos = new Map<string, string>();
    for (const r of ordered) {
      const lineId = lines.get(r.line_code)!;
      const ek = `${r.line_code}/${r.equipment_code}`;
      if (!eq.has(ek)) {
        const found = (await qc(c, `select id from ast.equipment where line_id=$1 and code=$2`, [lineId, r.equipment_code]))[0];
        if (found) eq.set(ek, found.id);
        else { eq.set(ek, (await qc(c, `insert into ast.equipment(line_id,code,name,kind) values ($1,$2,$3,$4) returning id`, [lineId, r.equipment_code, r.equipment_name, r.equipment_kind]))[0].id); created.equipment++; }
      }
      const pk = `${ek}/${r.position_code}`;
      if (!pos.has(pk)) {
        const found = (await qc(c, `select id from ast.position where equipment_id=$1 and code=$2`, [eq.get(ek), r.position_code]))[0];
        if (found) pos.set(pk, found.id);
        else { pos.set(pk, (await qc(c, `insert into ast.position(equipment_id,code,name,assembly,criticality) values ($1,$2,$3,$4,$5) returning id`, [eq.get(ek), r.position_code, r.position_name, r.assembly, Number(r.criticality)]))[0].id); created.positions++; }
      }
      const part = (await qc(c, `insert into ast.part(code,part_type_id,lot) values ($1,$2,$3) returning id`, [r.part_code, types.get(r.part_type_code), r.lot || null]))[0];
      created.parts++;
      await qc(c, `insert into ast.installation(part_id,position_id,installed_on,removed_on,removal_reason,installed_by) values ($1,$2,$3,$4,$5,$6)`,
        [part.id, pos.get(pk), r.installed_on, r.removed_on || null, r.removal_reason || null, userId]);
    }
  });
  return { ...created, rows: rows.length };
}

export async function exportAssetCsv() {
  const rows = await q(
    `select l.code as line_code, e.code as equipment_code, e.name as equipment_name, e.kind as equipment_kind, p.assembly, p.code as position_code, p.name as position_name, p.criticality,
            t.code as part_type_code, pt.code as part_code, pt.lot, i.installed_on, i.removed_on, i.removal_reason
     from ast.installation i join ast.part pt on pt.id=i.part_id join ast.part_type t on t.id=pt.part_type_id
     join ast.position p on p.id=i.position_id join ast.equipment e on e.id=p.equipment_id join cfg.line l on l.id=e.line_id
     order by l.code, e.code, p.code, i.installed_on`);
  return toCsv([[...ASSET_COLUMNS], ...rows.map((r) => ASSET_COLUMNS.map((c) => r[c]))]);
}

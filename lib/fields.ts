import { HttpError } from "./auth";
import { q, q1, qc, tx } from "./db";
import type { AttrDef } from "./engine/types";
import { displayValue, FIELD_TYPES, isEmpty, MATCHABLE, parseFieldValue, rowValue, writeFieldValue } from "./fieldValues";
import { parseCsv, toCsv } from "./csv";
import { categoryWeightLevels, loadCategoryConfig, mapAttrDef, minFieldCoverage } from "./repo";

/**
 * Product fields defined by category owners.
 * Rules: fields belong to a category; they are retired, never deleted; code and type are fixed once values exist;
 * only numeric, choice and boolean fields can drive matching; new matching fields start at weight 0.
 */
export type FieldInput = {
  code: string; name: string; type: AttrDef["type"]; kind?: "matching" | "info"; unit?: string | null; choices?: string[];
  absMin?: number | null; absMax?: number | null; required?: boolean; helpText?: string | null; section?: string | null; sortOrder?: number;
  aiVisible?: boolean; initialWeight?: number;
};

const CODE_RE = /^[a-z][a-z0-9_]{1,39}$/;
const RESERVED = new Set(["launch_ref", "product_name", "line", "run_no"]);

export function validateFieldInput(i: FieldInput): { clean: Required<Omit<FieldInput, "initialWeight">> & { initialWeight: number }; errors: string[] } {
  const errors: string[] = [];
  const code = String(i.code ?? "").trim();
  if (!CODE_RE.test(code)) errors.push("Code must start with a lowercase letter and use only lowercase letters, digits and underscores (2 to 40 characters)");
  if (RESERVED.has(code)) errors.push(`"${code}" is reserved`);
  const name = String(i.name ?? "").trim();
  if (name.length < 2 || name.length > 60) errors.push("Name must be 2 to 60 characters");
  if (!(FIELD_TYPES as readonly string[]).includes(i.type)) errors.push("Choose a field type");
  let kind: "matching" | "info" = i.kind ?? "matching";
  if (!(MATCHABLE as readonly string[]).includes(i.type)) kind = "info"; // text and date can never drive matching
  const unit = i.unit ? String(i.unit).trim().slice(0, 12) : null;
  let choices: string[] = [];
  let absMin: number | null = null;
  let absMax: number | null = null;
  if (i.type === "choice") {
    choices = [...new Set((i.choices ?? []).map((c) => String(c).trim()).filter(Boolean))];
    if (choices.length < 2) errors.push("A choice field needs at least two different options");
    if (choices.length > 30) errors.push("A choice field can have at most 30 options");
    if (choices.some((c) => c.length > 40)) errors.push("Each option must be 40 characters or fewer");
  }
  if (i.type === "numeric") {
    absMin = i.absMin ?? null; absMax = i.absMax ?? null;
    if (absMin === null || absMax === null || !Number.isFinite(absMin) || !Number.isFinite(absMax)) errors.push("A numeric field needs a minimum and a maximum allowed value");
    else if (absMin >= absMax) errors.push("The minimum must be below the maximum");
  }
  const weight = i.initialWeight ?? 0;
  if (!Number.isInteger(weight) || weight < 0 || weight > 5) errors.push("The starting weight must be a whole number from 0 to 5");
  const helpText = i.helpText ? String(i.helpText).trim().slice(0, 200) : null;
  const section = i.section ? String(i.section).trim().slice(0, 40) : null;
  const sortOrder = Number.isInteger(i.sortOrder) ? (i.sortOrder as number) : 100;
  return {
    clean: { code, name, type: i.type, kind, unit, choices, absMin, absMax, required: !!i.required, helpText, section, sortOrder, aiVisible: i.aiVisible ?? i.type !== "text", initialWeight: weight },
    errors,
  };
}

/** All fields of a category with how much of the history has a value (the impact check). */
export async function listFields(categoryId: string) {
  const cfg = await loadCategoryConfig(categoryId, { all: true });
  const accepted = `l.status='Closed' and l.ta_decision in ('Accepted','Accepted with conditions')`;
  const totalAccepted = (await q1(`select count(*)::int as n from core.launch_project l join core.product p on p.id=l.product_id where p.category_id=$1 and ${accepted}`, [categoryId]))!.n as number;
  const totalProducts = (await q1("select count(*)::int as n from core.product where category_id=$1", [categoryId]))!.n as number;
  const stats = await q(
    `select a.id,
       count(distinct v.product_id)::int as products,
       count(distinct v.product_id) filter (where exists (select 1 from core.launch_project l where l.product_id=v.product_id and ${accepted}))::int as accepted
     from cfg.attribute_def a left join core.product_attribute_value v on v.attribute_def_id=a.id where a.category_id=$1 group by a.id`, [categoryId]);
  const weights = await categoryWeightLevels(categoryId, cfg.attrDefs, cfg.paramDefs);
  const min = minFieldCoverage();
  return {
    totalAccepted, totalProducts, minCoverage: min,
    fields: cfg.attrDefs.map((a) => {
      const st = stats.find((s) => s.id === a.id);
      const coverage = totalAccepted ? (st?.accepted ?? 0) / totalAccepted : 0;
      const matching = (a.kind ?? "matching") === "matching" && (MATCHABLE as readonly string[]).includes(a.type);
      return {
        ...a, productsWithValue: st?.products ?? 0, acceptedWithValue: st?.accepted ?? 0, coverage,
        weight: weights.attributes[a.code] ?? null,
        usedForMatching: matching && a.status === "Active" && (totalAccepted === 0 || coverage >= min),
      };
    }),
  };
}

export async function createField(userId: string, categoryId: string, input: FieldInput) {
  const { clean, errors } = validateFieldInput(input);
  if (errors.length) throw new HttpError(422, errors.join("; "), "validation");
  const cat = await q1("select id from cfg.category where id=$1 and active", [categoryId]);
  if (!cat) throw new HttpError(404, "Category not found", "not_found");
  const clash = await q1("select status from cfg.attribute_def where category_id=$1 and code=$2", [categoryId, clean.code]);
  if (clash) throw new HttpError(409, `A field with the code "${clean.code}" already exists (${clash.status}). Use another code.`, "conflict");

  return tx({ userId, reason: `New product field ${clean.code}` }, async (c) => {
    const f = (await qc(c,
      `insert into cfg.attribute_def(category_id,code,name,unit,data_type,choices,required,abs_min,abs_max,kind,help_text,section,sort_order,status,ai_visible,created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Draft',$14,$15) returning id`,
      [categoryId, clean.code, clean.name, clean.unit, clean.type, clean.type === "choice" ? JSON.stringify(clean.choices) : null, clean.required, clean.absMin, clean.absMax,
        clean.kind, clean.helpText, clean.section, clean.sortOrder, clean.aiVisible, userId]))[0];
    if (clean.kind === "matching") {
      // The starting weight goes into a new category weight set that supersedes the old one (weight sets are never edited).
      const prev = (await qc(c, "select id from rec.weight_set where level='category' and category_id=$1 and status='Active'", [categoryId]))[0];
      const set = (await qc(c,
        "insert into rec.weight_set(level,category_id,status,created_by,approved_by,reason,supersedes_id) values ('category',$1,'Active',$2,$2,$3,$4) returning id",
        [categoryId, userId, `New product field "${clean.name}" added with starting weight ${clean.initialWeight}`, prev?.id ?? null]))[0];
      if (prev) {
        await c.query("insert into rec.weight_item select $1, kind, item_id, weight from rec.weight_item where weight_set_id=$2", [set.id, prev.id]);
        await c.query("update rec.weight_set set status='Retired' where id=$1", [prev.id]);
      }
      await c.query("insert into rec.weight_item values ($1,'attribute',$2,$3)", [set.id, f.id, clean.initialWeight]);
    }
    return { id: f.id as string };
  });
}

export type FieldPatch = Partial<Pick<FieldInput, "name" | "unit" | "choices" | "absMin" | "absMax" | "required" | "helpText" | "section" | "sortOrder" | "aiVisible" | "kind">>;

export async function updateField(userId: string, fieldId: string, patch: FieldPatch) {
  const row = await q1("select * from cfg.attribute_def where id=$1", [fieldId]);
  if (!row) throw new HttpError(404, "Field not found", "not_found");
  const hasValues = !!(await q1("select 1 from core.product_attribute_value where attribute_def_id=$1 limit 1", [fieldId]));
  const errors: string[] = [];
  const next: Record<string, unknown> = {};

  if (patch.name !== undefined) { const n = patch.name.trim(); if (n.length < 2 || n.length > 60) errors.push("Name must be 2 to 60 characters"); else next.name = n; }
  if (patch.helpText !== undefined) next.help_text = patch.helpText ? patch.helpText.trim().slice(0, 200) : null;
  if (patch.section !== undefined) next.section = patch.section ? patch.section.trim().slice(0, 40) : null;
  if (patch.sortOrder !== undefined) { if (!Number.isInteger(patch.sortOrder)) errors.push("Order must be a whole number"); else next.sort_order = patch.sortOrder; }
  if (patch.aiVisible !== undefined) next.ai_visible = !!patch.aiVisible;
  if (patch.required !== undefined) next.required = !!patch.required;
  if (patch.unit !== undefined) {
    if (hasValues && (patch.unit ?? null) !== (row.unit ?? null)) errors.push("The unit cannot change once products have values. Retire this field and add a new one.");
    else next.unit = patch.unit ? patch.unit.trim().slice(0, 12) : null;
  }
  if (patch.kind !== undefined) {
    if (patch.kind === "matching" && !(MATCHABLE as readonly string[]).includes(row.data_type)) errors.push("Text and date fields cannot be used for matching");
    else next.kind = patch.kind;
  }
  if (patch.choices !== undefined) {
    if (row.data_type !== "choice") errors.push("Only choice fields have options");
    else {
      const list = [...new Set(patch.choices.map((c) => c.trim()).filter(Boolean))];
      const old: string[] = row.choices ?? [];
      if (list.length < 2 || list.length > 30) errors.push("A choice field needs 2 to 30 options");
      else if (hasValues && old.some((o) => !list.includes(o))) errors.push("Options can be added, but not removed or renamed, once products have values");
      else next.choices = JSON.stringify(list);
    }
  }
  if (patch.absMin !== undefined || patch.absMax !== undefined) {
    if (row.data_type !== "numeric") errors.push("Only numeric fields have a range");
    else {
      const mn = patch.absMin ?? Number(row.abs_min);
      const mx = patch.absMax ?? Number(row.abs_max);
      if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn >= mx) errors.push("The minimum must be below the maximum");
      else if (hasValues && (mn > Number(row.abs_min) || mx < Number(row.abs_max))) errors.push("The range can be widened, but not narrowed, once products have values");
      else { next.abs_min = mn; next.abs_max = mx; }
    }
  }
  if (errors.length) throw new HttpError(422, errors.join("; "), "validation");
  const keys = Object.keys(next);
  if (!keys.length) return { id: fieldId, changed: 0 };
  await tx({ userId, reason: "Product field edited" }, async (c) => {
    await c.query(`update cfg.attribute_def set ${keys.map((k, i) => `${k}=$${i + 2}`).join(", ")} where id=$1`, [fieldId, ...keys.map((k) => next[k])]);
  });
  return { id: fieldId, changed: keys.length };
}

export async function setFieldStatus(userId: string, fieldId: string, status: "Active" | "Retired", reason?: string) {
  const row = await q1("select * from cfg.attribute_def where id=$1", [fieldId]);
  if (!row) throw new HttpError(404, "Field not found", "not_found");
  if (row.status === status) throw new HttpError(409, `The field is already ${status}`, "conflict");
  if (status === "Retired" && !reason?.trim()) throw new HttpError(422, "Give a reason for retiring the field", "validation");
  await tx({ userId, reason: reason?.trim() || `Field ${status === "Active" ? "activated" : "retired"}` }, async (c) => {
    await c.query("update cfg.attribute_def set status=$2, approved_by=$3 where id=$1", [fieldId, status, status === "Active" ? userId : row.approved_by]);
  });
  return { id: fieldId, status };
}

/* ------------------------------------------------------------------ back-fill values onto existing products */
const fieldCols = (defs: AttrDef[]) => defs.map((d) => `attr_${d.code}`);

export async function backfillTemplate(categoryId: string): Promise<string> {
  const cfg = await loadCategoryConfig(categoryId, { all: true });
  const defs = cfg.attrDefs.filter((d) => d.status !== "Retired");
  const products = await q("select id, code, name from core.product where category_id=$1 order by code", [categoryId]);
  const vals = products.length ? await q(
    `select v.product_id, a.code, a.data_type, v.value_num, v.value_choice, v.value_text, v.value_date, v.value_bool from core.product_attribute_value v
     join cfg.attribute_def a on a.id=v.attribute_def_id where v.product_id = any($1::uuid[])`, [products.map((p) => p.id)]) : [];
  const header = ["launch_ref", "product_name", ...fieldCols(defs)];
  const rows = products.map((p) => [p.code, p.name, ...defs.map((d) => {
    const r = vals.find((v) => v.product_id === p.id && v.code === d.code);
    return r ? displayValue(rowValue(r)) : "";
  })]);
  return toCsv([header, ...rows]);
}

export type BackfillReport = {
  rows: number; products: number; newValues: number; changedValues: number; unchanged: number;
  errors: { row: number | null; launch: string | null; field: string | null; message: string }[];
  warnings: { row: number | null; launch: string | null; message: string }[];
  applied: boolean;
};

/** Check (dryRun) or apply values for existing products. Only non-empty cells are written; empty cells never clear a value. All or nothing. */
export async function backfill(userId: string, input: { categoryId: string; text: string; dryRun: boolean }): Promise<BackfillReport> {
  const cfg = await loadCategoryConfig(input.categoryId, { all: true });
  const defs = cfg.attrDefs.filter((d) => d.status !== "Retired");
  const report: BackfillReport = { rows: 0, products: 0, newValues: 0, changedValues: 0, unchanged: 0, errors: [], warnings: [], applied: false };
  const err = (row: number | null, launch: string | null, field: string | null, message: string) => report.errors.push({ row, launch, field, message });

  let table: string[][];
  try { table = parseCsv(input.text); } catch (e: any) { err(null, null, null, e.message); return report; }
  if (table.length < 2) { err(null, null, null, "The file has no data rows"); return report; }
  if (table.length > 5001) { err(null, null, null, "The file has more than 5,000 rows. Split it."); return report; }
  const header = table[0].map((h) => h.trim().toLowerCase());
  if (!header.includes("launch_ref")) { err(1, null, "launch_ref", 'Missing required column "launch_ref"'); return report; }
  const cols = defs.map((d) => ({ d, i: header.indexOf(`attr_${d.code}`) })).filter((x) => x.i >= 0);
  const known = new Set(["launch_ref", "product_name", ...fieldCols(defs)]);
  for (const h of header) if (h && !known.has(h)) report.warnings.push({ row: 1, launch: null, message: `Column "${h}" is not an active or draft field of this category and is ignored` });
  if (!cols.length) { err(1, null, null, "The file has no field columns (attr_…) to fill in"); return report; }

  const products = await q("select id, code from core.product where category_id=$1", [input.categoryId]);
  const byCode = new Map(products.map((p) => [p.code as string, p.id as string]));
  const existing = await q(
    `select v.product_id, a.code, a.data_type, v.value_num, v.value_choice, v.value_text, v.value_date, v.value_bool from core.product_attribute_value v
     join cfg.attribute_def a on a.id=v.attribute_def_id where a.category_id=$1`, [input.categoryId]);
  const seen = new Set<string>();
  const writes: { productId: string; def: AttrDef; value: number | string | boolean }[] = [];
  const idx = header.indexOf("launch_ref");

  table.slice(1).forEach((r, k) => {
    const n = k + 2;
    report.rows++;
    const ref = (r[idx] ?? "").trim();
    if (!ref) return err(n, null, "launch_ref", "launch_ref is empty");
    const pid = byCode.get(ref);
    if (!pid) return err(n, ref, "launch_ref", `No product with code "${ref}" in this category`);
    if (seen.has(ref)) return err(n, ref, "launch_ref", `"${ref}" appears more than once`);
    seen.add(ref);
    for (const { d, i } of cols) {
      const raw = r[i] ?? "";
      if (isEmpty(raw)) continue;
      const p = parseFieldValue(d, raw);
      if (!p.ok) { err(n, ref, `attr_${d.code}`, p.message); continue; }
      const prev = existing.find((e) => e.product_id === pid && e.code === d.code);
      const old = prev ? rowValue(prev) : undefined;
      if (old === undefined) report.newValues++;
      else if (String(old) === String(p.value)) { report.unchanged++; continue; }
      else { report.changedValues++; report.warnings.push({ row: n, launch: ref, message: `${d.name} changes from ${displayValue(old)} to ${displayValue(p.value)}` }); }
      writes.push({ productId: pid, def: d, value: p.value });
    }
  });
  report.products = seen.size;
  if (report.errors.length || input.dryRun) return report;
  if (!writes.length) { report.warnings.push({ row: null, launch: null, message: "Nothing to write: every value is already stored" }); return report; }

  await tx({ userId, reason: "Product field back-fill" }, async (c) => {
    for (const w of writes) await writeFieldValue(c, w.productId, w.def, w.value);
  });
  report.applied = true;
  return report;
}

export { mapAttrDef };

/** The definition history of one field, read from the audit log: each change as old value to new value. */
export async function fieldHistory(fieldId: string) {
  const rows = await q(
    `select e.at, e.action, e.reason, e.before, e.after, u.name as user_name from audit.event e left join cfg.app_user u on u.id=e.user_id
     where e.entity='cfg.attribute_def' and e.entity_id=$1 order by e.id desc limit 100`, [fieldId]);
  const skip = new Set(["id", "category_id", "created_at", "created_by"]);
  return rows.map((r) => {
    const changes: { field: string; from: unknown; to: unknown }[] = [];
    if (r.action === "UPDATE" && r.before && r.after)
      for (const k of Object.keys(r.after)) if (!skip.has(k) && JSON.stringify(r.before[k]) !== JSON.stringify(r.after[k])) changes.push({ field: k, from: r.before[k], to: r.after[k] });
    return { at: r.at, action: r.action, by: r.user_name ?? "system", reason: r.reason, changes };
  });
}

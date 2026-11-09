import type { PoolClient } from "pg";
import type { AttrDef } from "./engine/types";

export const FIELD_TYPES = ["numeric", "choice", "boolean", "text", "date"] as const;
export const MATCHABLE = ["numeric", "choice", "boolean"] as const;
export const MAX_TEXT = 500;

export type FieldValue = number | string | boolean;

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

/** Parse and validate one value against its field definition. Used by forms, imports and back-fills. */
export function parseFieldValue(def: Pick<AttrDef, "type" | "name" | "choices" | "absMin" | "absMax">, raw: unknown): { ok: true; value: FieldValue } | { ok: false; message: string } {
  const s = typeof raw === "string" ? raw.trim() : raw;
  switch (def.type) {
    case "numeric": {
      const n = typeof s === "number" ? s : Number(String(s).replace(",", "."));
      if (s === "" || !Number.isFinite(n)) return { ok: false, message: `${def.name}: "${raw}" is not a number` };
      if ((def.absMin !== null && n < def.absMin) || (def.absMax !== null && n > def.absMax)) return { ok: false, message: `${def.name} ${n} is outside the allowed range ${def.absMin} to ${def.absMax}` };
      return { ok: true, value: n };
    }
    case "choice":
      return def.choices?.includes(String(s)) ? { ok: true, value: String(s) } : { ok: false, message: `${def.name}: "${raw}" is not one of ${def.choices?.join(", ")}` };
    case "boolean": {
      const t = String(s).toLowerCase();
      if (["true", "yes", "y", "1"].includes(t)) return { ok: true, value: true };
      if (["false", "no", "n", "0"].includes(t)) return { ok: true, value: false };
      return { ok: false, message: `${def.name}: "${raw}" must be yes or no` };
    }
    case "date":
      return typeof s === "string" && isDate(s) ? { ok: true, value: s } : { ok: false, message: `${def.name}: "${raw}" is not a date. Use YYYY-MM-DD.` };
    case "text": {
      const t = String(s);
      if (t.length > MAX_TEXT) return { ok: false, message: `${def.name} is longer than ${MAX_TEXT} characters` };
      return t === "" ? { ok: false, message: `${def.name} is empty` } : { ok: true, value: t };
    }
  }
}

export const isEmpty = (raw: unknown) => raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");

/** Write one typed value. Replaces an existing value for the same product and field. */
export async function writeFieldValue(c: PoolClient, productId: string, def: Pick<AttrDef, "id" | "type">, value: FieldValue) {
  const cols = { value_num: null as unknown, value_choice: null as unknown, value_text: null as unknown, value_date: null as unknown, value_bool: null as unknown };
  if (def.type === "numeric") cols.value_num = value;
  else if (def.type === "choice") cols.value_choice = value;
  else if (def.type === "text") cols.value_text = value;
  else if (def.type === "date") cols.value_date = value;
  else cols.value_bool = value;
  await c.query(
    `insert into core.product_attribute_value(product_id,attribute_def_id,value_num,value_choice,value_text,value_date,value_bool)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (product_id, attribute_def_id) do update set value_num=excluded.value_num, value_choice=excluded.value_choice,
       value_text=excluded.value_text, value_date=excluded.value_date, value_bool=excluded.value_bool`,
    [productId, def.id, cols.value_num, cols.value_choice, cols.value_text, cols.value_date, cols.value_bool]);
}

/** Read the typed value out of a row from product_attribute_value joined with its data_type. */
export function rowValue(r: { data_type: string; value_num: unknown; value_choice: unknown; value_text: unknown; value_date: unknown; value_bool: unknown }): FieldValue | undefined {
  switch (r.data_type) {
    case "numeric": return r.value_num === null ? undefined : Number(r.value_num);
    case "choice": return (r.value_choice as string) ?? undefined;
    case "text": return (r.value_text as string) ?? undefined;
    case "date": return (r.value_date as string) ?? undefined;
    case "boolean": return r.value_bool === null ? undefined : (r.value_bool as boolean);
  }
  return undefined;
}

export const displayValue = (v: FieldValue | undefined) => (v === undefined ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

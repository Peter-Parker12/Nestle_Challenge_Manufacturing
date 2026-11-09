"use client";
import { useState } from "react";

export type FieldDef = {
  code: string; name: string; type: string; unit?: string | null; helpText?: string | null; choices?: string[] | null;
  absMin?: number | null; absMax?: number | null; required?: boolean; kind?: string; section?: string | null;
};

/** One product field, rendered by type. Values are strings in the form and converted on save. */
export function FieldInput({ def, value, onChange, id }: { def: FieldDef; value: string; onChange: (v: string) => void; id: string }) {
  const info = (def.kind ?? "matching") === "info";
  return (
    <div className="field">
      <label htmlFor={id}>
        {def.name}{def.unit ? ` (${def.unit})` : ""}{def.required ? " *" : ""}
        {info && <span className="badge b-gray" style={{ marginLeft: 6 }}>info</span>}
      </label>
      {def.type === "choice" ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>{def.choices?.map((c) => <option key={c}>{c}</option>)}
        </select>
      ) : def.type === "boolean" ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
      ) : def.type === "date" ? (
        <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : def.type === "text" ? (
        <textarea id={id} maxLength={500} style={{ minHeight: 60 }} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} type="number" step="any" min={def.absMin ?? undefined} max={def.absMax ?? undefined} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {def.type === "numeric" && def.absMin !== null && def.absMin !== undefined && <div className="small muted">Allowed {def.absMin} to {def.absMax}</div>}
      {def.type === "text" && <div className="small muted">{value.length} / 500</div>}
      {def.helpText && <div className="small muted">{def.helpText}</div>}
    </div>
  );
}

export function FieldInputPreview({ def }: { def: FieldDef }) {
  const [v, setV] = useState("");
  return <FieldInput def={def} value={v} onChange={setV} id="preview-field" />;
}

/** Group fields by section, keeping the given order. Fields with no section come first, under no heading. */
export function bySection<T extends { section?: string | null }>(defs: T[]): { section: string | null; items: T[] }[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, T[]>();
  for (const d of defs) {
    const k = d.section || null;
    if (!map.has(k)) { map.set(k, []); order.push(k); }
    map.get(k)!.push(d);
  }
  return order.sort((a, b) => (a === null ? -1 : b === null ? 1 : 0)).map((k) => ({ section: k, items: map.get(k)! }));
}

export const showValue = (v: unknown) => (v === undefined || v === null || v === "" ? "–" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

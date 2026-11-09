"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { FieldInputPreview } from "@/components/FieldInput";
import { LEVEL_LABELS } from "@/lib/engine/weights";
import { can, type Role } from "@/lib/permissions";

type Msg = { kind: "err" | "ok" | "info" | "warn"; text: string } | null;
const TYPE_LABEL: Record<string, string> = { numeric: "Number", choice: "Choice", boolean: "Yes / no", text: "Text", date: "Date" };
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40);
const blank = { name: "", code: "", codeTouched: false, type: "numeric", kind: "matching", unit: "", absMin: "", absMax: "", choices: "", required: false, helpText: "", section: "", weight: 0, aiVisible: true, aiTouched: false };

export default function ProductFields() {
  const [role, setRole] = useState<Role | undefined>();
  const [cats, setCats] = useState<{ id: string; name: string; code: string }[]>([]);
  const [catId, setCatId] = useState("");
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>(blank);
  const [panel, setPanel] = useState<{ id: string; mode: "edit" | "activate" | "retire" | "history" } | null>(null);

  const owner = can(role, "manageFields");
  const filler = can(role, "backfillFields");

  useEffect(() => {
    api("/api/session").then((r) => r.ok && setRole(r.data.user.role));
    api("/api/launches").then((r) => {
      if (!r.ok) return;
      setCats(r.data.categories);
      setCatId(r.data.categories.find((c: any) => c.code === "UHT_DRINK")?.id ?? r.data.categories[0]?.id ?? "");
    });
  }, []);
  const load = useCallback(async () => {
    if (!catId) return;
    const r = await api(`/api/categories/${catId}/fields`);
    if (r.ok) setData(r.data); else setMsg({ kind: "err", text: r.message ?? "Could not load the fields" });
  }, [catId]);
  useEffect(() => { setPanel(null); load(); }, [load]);

  const set = (patch: Record<string, unknown>) => setForm((f: any) => {
    const next = { ...f, ...patch };
    if ("name" in patch && !next.codeTouched) next.code = slug(String(patch.name));
    if ("type" in patch) {
      if (patch.type === "text" || patch.type === "date") next.kind = "info";
      if (!next.aiTouched) next.aiVisible = patch.type !== "text";
    }
    return next;
  });

  async function create() {
    setBusy(true); setMsg(null);
    const body = {
      code: form.code, name: form.name, type: form.type, kind: form.kind, unit: form.unit || null,
      choices: form.type === "choice" ? form.choices.split("\n").map((s: string) => s.trim()).filter(Boolean) : undefined,
      absMin: form.type === "numeric" && form.absMin !== "" ? Number(form.absMin) : null, absMax: form.type === "numeric" && form.absMax !== "" ? Number(form.absMax) : null,
      required: form.required, helpText: form.helpText || null, section: form.section || null, aiVisible: form.aiVisible, initialWeight: Number(form.weight),
    };
    const r = await api(`/api/categories/${catId}/fields`, { body });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Could not save the field" });
    setForm(blank);
    setMsg({ kind: "ok", text: `"${body.name}" was saved as a Draft. Next: fill in values for the existing launches (below), then activate it so it appears on the forms.` });
    load();
  }

  async function act(f: any, action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setMsg(null);
    const r = await api(`/api/categories/${catId}/fields/${f.id}`, { method: "PATCH", body: { action, ...extra } });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Failed" });
    setPanel(null);
    setMsg({ kind: "ok", text: action === "activate" || action === "reactivate" ? `"${f.name}" is now active.` : action === "retire" ? `"${f.name}" is retired. Existing values are kept; it no longer appears on forms.` : `"${f.name}" updated.` });
    load();
  }

  const status = (f: any) =>
    f.status === "Retired" ? { text: "Retired", cls: "b-gray" }
    : f.status === "Draft" ? { text: "Draft: not on forms yet", cls: "b-blue" }
    : f.kind === "info" || !["numeric", "choice", "boolean"].includes(f.type) ? { text: "Information only", cls: "b-gray" }
    : f.usedForMatching ? { text: "Used for matching", cls: "b-green" }
    : { text: `Waiting for data (needs ${Math.round((data?.minCoverage ?? 0.3) * 100)}%)`, cls: "b-amber" };

  const counts = data ? { active: data.fields.filter((f: any) => f.status === "Active").length, draft: data.fields.filter((f: any) => f.status === "Draft").length, retired: data.fields.filter((f: any) => f.status === "Retired").length } : null;

  return (
    <>
      <div className="eyebrow">Configuration</div>
      <h1>Product fields</h1>
      <p className="sub">
        Add fields that describe a product in this category, such as pack type or supplier. Fields that <b>affect matching</b> help find similar past launches. <b>Information</b> fields are stored and shown, and never change a recommendation. Fields are retired, never deleted.
      </p>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="field" style={{ minWidth: 280 }}>
          <label htmlFor="fc">Category</label>
          <select id="fc" value={catId} onChange={(e) => setCatId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
        <Link href="/config" className="small" style={{ alignSelf: "flex-end", paddingBottom: 10 }}>Weights and expert rules →</Link>
      </div>

      {role && !owner && <div className="msg info">You can see the fields. Only category owners add or change them. Switch to the category owner to try it.</div>}
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}

      {data && counts && (
        <div className="grid g4" style={{ marginBottom: 14 }}>
          <div className="card kpi"><div className="l">Active fields</div><div className="v">{counts.active}</div></div>
          <div className="card kpi"><div className="l">Draft</div><div className="v">{counts.draft}</div></div>
          <div className="card kpi"><div className="l">Retired</div><div className="v">{counts.retired}</div></div>
          <div className="card kpi"><div className="l">Accepted launches in history</div><div className="v">{data.totalAccepted}</div><div className="d">A matching field needs a value on at least {Math.round(data.minCoverage * 100)}% of them</div></div>
        </div>
      )}

      <div className="card">
        <h2>Fields in this category</h2>
        <div className="tw">
          <table>
            <thead><tr><th>Field</th><th>Type</th><th>Status</th><th>Values in history</th><th>Weight</th><th>AI assistants</th>{owner && <th />}</tr></thead>
            <tbody>
              {!data && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
              {data?.fields.map((f: any) => {
                const st = status(f);
                const open = panel?.id === f.id;
                return (
                  <FragmentRow key={f.id}>
                    <tr>
                      <td><b>{f.name}</b>{f.required && <span className="badge b-amber" style={{ marginLeft: 6 }}>required</span>}<div className="mono muted">{f.code}{f.section ? ` · ${f.section}` : ""}</div>{f.helpText && <div className="small muted">{f.helpText}</div>}</td>
                      <td>{TYPE_LABEL[f.type]}{f.unit ? ` (${f.unit})` : ""}{f.type === "choice" && <div className="small muted">{f.choices?.join(", ")}</div>}{f.type === "numeric" && <div className="small muted">{f.absMin} to {f.absMax}</div>}</td>
                      <td><span className={`badge ${st.cls}`}>{st.text}</span></td>
                      <td style={{ minWidth: 150 }}>
                        <div className="bar" role="img" aria-label={`${Math.round(f.coverage * 100)}% of accepted launches have a value`}><i style={{ width: `${Math.round(f.coverage * 100)}%` }} /></div>
                        <div className="small muted">{f.acceptedWithValue} of {data.totalAccepted} launches ({Math.round(f.coverage * 100)}%)</div>
                      </td>
                      <td>{f.kind === "matching" && f.weight !== null ? `${f.weight} · ${LEVEL_LABELS[f.weight]}` : <span className="muted">–</span>}</td>
                      <td>{f.aiVisible ? <span className="badge b-blue">shared</span> : <span className="badge b-gray">never shared</span>}</td>
                      {owner && (
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            {f.status !== "Retired" && <button className="ghost small" onClick={() => setPanel(open && panel?.mode === "edit" ? null : { id: f.id, mode: "edit" })}>Edit</button>}
                            {f.status === "Draft" && <button className="small" onClick={() => setPanel({ id: f.id, mode: "activate" })}>Activate</button>}
                            {f.status === "Active" && <button className="ghost small" onClick={() => setPanel({ id: f.id, mode: "retire" })}>Retire</button>}
                            {f.status === "Draft" && <button className="ghost small" onClick={() => setPanel({ id: f.id, mode: "retire" })}>Discard</button>}
                            {f.status === "Retired" && <button className="ghost small" disabled={busy} onClick={() => act(f, "reactivate")}>Reactivate</button>}
                            {can(role, "viewAudit") && <button className="ghost small" onClick={() => setPanel(open && panel?.mode === "history" ? null : { id: f.id, mode: "history" })}>History</button>}
                          </div>
                        </td>
                      )}
                    </tr>
                    {open && owner && (
                      <tr><td colSpan={7} style={{ background: "var(--soft)" }}>
                        {panel!.mode === "activate" && <ActivatePanel f={f} total={data.totalAccepted} min={data.minCoverage} busy={busy} onConfirm={() => act(f, "activate")} onCancel={() => setPanel(null)} />}
                        {panel!.mode === "retire" && <RetirePanel f={f} busy={busy} onConfirm={(reason: string) => act(f, "retire", { reason })} onCancel={() => setPanel(null)} />}
                        {panel!.mode === "history" && <HistoryPanel catId={catId} f={f} onClose={() => setPanel(null)} />}
                        {panel!.mode === "edit" && <EditPanel f={f} busy={busy} onSave={(patch: Record<string, unknown>) => act(f, "update", { patch })} onCancel={() => setPanel(null)} />}
                      </td></tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Weights are set per category on <Link href="/config">Configuration</Link>. A new matching field starts at 0 (ignored) until the owner raises it.
        </p>
      </div>

      {owner && (
        <div className="card">
          <h2>Add a field</h2>
          <div className="grid g2">
            <div>
              <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
                <div className="field"><label htmlFor="n">Name</label><input id="n" value={form.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="For example: Pack type" /></div>
                <div className="field"><label htmlFor="c">Code (used in files)</label><input id="c" className="mono" value={form.code} maxLength={40} onChange={(e) => setForm({ ...form, code: e.target.value, codeTouched: true })} placeholder="pack_type" /></div>
                <div className="field"><label htmlFor="t">Type</label>
                  <select id="t" value={form.type} onChange={(e) => set({ type: e.target.value })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="field"><label htmlFor="s">Section on the form (optional)</label><input id="s" value={form.section} maxLength={40} onChange={(e) => set({ section: e.target.value })} placeholder="Packaging" /></div>
              </div>

              {form.type === "numeric" && (
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <div className="field"><label htmlFor="u">Unit</label><input id="u" value={form.unit} maxLength={12} onChange={(e) => set({ unit: e.target.value })} placeholder="%" /></div>
                  <div className="field"><label htmlFor="mn">Lowest allowed value</label><input id="mn" type="number" step="any" value={form.absMin} onChange={(e) => set({ absMin: e.target.value })} /></div>
                  <div className="field"><label htmlFor="mx">Highest allowed value</label><input id="mx" type="number" step="any" value={form.absMax} onChange={(e) => set({ absMax: e.target.value })} /></div>
                </div>
              )}
              {form.type === "choice" && (
                <div className="field" style={{ marginTop: 12 }}><label htmlFor="ch">Options (one per line, at least two)</label>
                  <textarea id="ch" value={form.choices} onChange={(e) => set({ choices: e.target.value })} placeholder={"carton\npouch\nbottle"} /></div>
              )}
              <div className="field" style={{ marginTop: 12 }}><label htmlFor="h">Help text shown under the field (optional)</label><input id="h" value={form.helpText} maxLength={200} onChange={(e) => set({ helpText: e.target.value })} /></div>

              <h3>How it is used</h3>
              {(form.type === "text" || form.type === "date") ? (
                <p className="small muted" style={{ margin: 0 }}>Text and date fields are <b>information only</b>. They are stored and shown, and never change which launches count as similar.</p>
              ) : (
                <div className="row" role="radiogroup" aria-label="How the field is used">
                  <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="radio" name="kind" checked={form.kind === "matching"} onChange={() => set({ kind: "matching" })} />Affects matching</label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="radio" name="kind" checked={form.kind === "info"} onChange={() => set({ kind: "info" })} />Information only</label>
                </div>
              )}
              {form.kind === "matching" && !(form.type === "text" || form.type === "date") && (
                <div className="field" style={{ marginTop: 10, maxWidth: 280 }}><label htmlFor="w">Starting weight</label>
                  <select id="w" value={form.weight} onChange={(e) => set({ weight: Number(e.target.value) })}>{LEVEL_LABELS.map((l, i) => <option key={l} value={i}>{i} · {l}</option>)}</select>
                  <div className="small muted">Keep this at 0 until the field has values for enough past launches.</div></div>
              )}
              <div className="row" style={{ marginTop: 12, gap: 18 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="checkbox" checked={form.required} onChange={(e) => set({ required: e.target.checked })} />Required on new launches</label>
                <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="checkbox" checked={form.aiVisible} onChange={(e) => setForm({ ...form, aiVisible: e.target.checked, aiTouched: true })} />Allow AI assistants (Claude, Copilot) to see this field</label>
              </div>
              {form.type === "text" && form.aiVisible && <div className="msg warn">Free text can contain confidential or personal details. It is off by default. Only allow AI assistants to see it if the text is safe to send.</div>}
              {form.required && <div className="msg warn">A required field blocks new launches and imports that leave it empty. Older launches without a value stay as they are.</div>}
              <div style={{ marginTop: 14 }}><button disabled={busy || !form.name.trim() || !form.code.trim()} onClick={create}>{busy ? "Saving…" : "Save as draft"}</button></div>
            </div>

            <div>
              <div className="eyebrow">Preview on the launch form</div>
              <div className="preview"><FieldInputPreview def={{ name: form.name || "Field name", code: form.code, type: form.type, unit: form.unit, helpText: form.helpText, choices: form.choices.split("\n").map((s: string) => s.trim()).filter(Boolean), absMin: form.absMin === "" ? null : Number(form.absMin), absMax: form.absMax === "" ? null : Number(form.absMax), required: form.required, kind: form.kind }} /></div>
              <p className="small muted">A new field is saved as a <b>Draft</b>: it is not on any form yet. Fill in values for existing launches, check the coverage, then activate it.</p>
            </div>
          </div>
        </div>
      )}

      {filler && catId && <Backfill catId={catId} onDone={load} />}
    </>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function HistoryPanel({ catId, f, onClose }: any) {
  const [events, setEvents] = useState<any[] | null>(null);
  useEffect(() => { api(`/api/categories/${catId}/fields/${f.id}/history`).then((r) => setEvents(r.ok ? r.data.events : [])); }, [catId, f.id]);
  return (
    <div>
      <b>History of "{f.name}"</b>
      {!events && <p className="muted">Loading…</p>}
      {events && events.length === 0 && <p className="muted">No recorded changes.</p>}
      <ul className="small" style={{ paddingLeft: 18 }}>
        {events?.map((e, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            <span className="mono">{new Date(e.at).toISOString().replace("T", " ").slice(0, 16)}</span> · {e.by} · {e.action === "INSERT" ? "created" : "changed"}{e.reason ? ` · "${e.reason}"` : ""}
            {e.changes.map((c: any, k: number) => <div key={k} className="muted">{c.field}: {JSON.stringify(c.from)} → {JSON.stringify(c.to)}</div>)}
          </li>
        ))}
      </ul>
      <button className="ghost small" onClick={onClose}>Close</button>
    </div>
  );
}

function ActivatePanel({ f, total, min, busy, onConfirm, onCancel }: any) {
  const pct = Math.round(f.coverage * 100);
  const matching = f.kind === "matching" && ["numeric", "choice", "boolean"].includes(f.type);
  return (
    <div>
      <b>Activate "{f.name}"</b>
      <p style={{ margin: "6px 0" }}>It will appear on the New launch form{f.required ? " as a required field" : ""} and in imports and exports.</p>
      {matching && (
        <div className={`msg ${f.coverage >= min ? "ok" : "warn"}`} style={{ margin: "6px 0" }}>
          {f.acceptedWithValue} of {total} accepted launches ({pct}%) have a value. {f.coverage >= min
            ? "That is enough for it to take part in matching, once its weight is above 0."
            : `Below ${Math.round(min * 100)}%, so it will not affect matching yet. Fill in more values with the back-fill below, or accept that it starts as information only.`}
        </div>
      )}
      <div className="row"><button disabled={busy} onClick={onConfirm}>Activate</button><button className="ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function RetirePanel({ f, busy, onConfirm, onCancel }: any) {
  const [reason, setReason] = useState("");
  return (
    <div>
      <b>{f.status === "Draft" ? "Discard" : "Retire"} "{f.name}"</b>
      <p style={{ margin: "6px 0" }}>Values already stored are kept, but the field disappears from forms, imports and matching. It can be reactivated later. It is never deleted.</p>
      <div className="row"><div className="field" style={{ minWidth: 320 }}><label htmlFor="rr">Reason (required)</label><input id="rr" value={reason} onChange={(e) => setReason(e.target.value)} /></div></div>
      <div className="row" style={{ marginTop: 8 }}><button className="danger" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason)}>{f.status === "Draft" ? "Discard" : "Retire"}</button><button className="ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function EditPanel({ f, busy, onSave, onCancel }: any) {
  const [v, setV] = useState<any>({ name: f.name, helpText: f.helpText ?? "", section: f.section ?? "", sortOrder: f.sortOrder ?? 0, required: f.required, aiVisible: f.aiVisible, kind: f.kind, unit: f.unit ?? "", absMin: f.absMin ?? "", absMax: f.absMax ?? "", choices: (f.choices ?? []).join("\n") });
  const locked = f.productsWithValue > 0;
  const save = () => {
    const p: any = {};
    if (v.name !== f.name) p.name = v.name;
    if (v.helpText !== (f.helpText ?? "")) p.helpText = v.helpText || null;
    if (v.section !== (f.section ?? "")) p.section = v.section || null;
    if (Number(v.sortOrder) !== (f.sortOrder ?? 0)) p.sortOrder = Number(v.sortOrder);
    if (v.required !== f.required) p.required = v.required;
    if (v.aiVisible !== f.aiVisible) p.aiVisible = v.aiVisible;
    if (v.kind !== f.kind) p.kind = v.kind;
    if (f.type === "numeric") { if (v.unit !== (f.unit ?? "")) p.unit = v.unit || null; if (Number(v.absMin) !== f.absMin) p.absMin = Number(v.absMin); if (Number(v.absMax) !== f.absMax) p.absMax = Number(v.absMax); }
    if (f.type === "choice") { const list = v.choices.split("\n").map((s: string) => s.trim()).filter(Boolean); if (list.join("|") !== (f.choices ?? []).join("|")) p.choices = list; }
    onSave(p);
  };
  return (
    <div>
      <b>Edit "{f.name}"</b>
      {locked && <p className="small muted" style={{ margin: "4px 0" }}>{f.productsWithValue} products already have a value. The code and type are fixed, options can only be added, the range can only be widened, and the unit cannot change.</p>}
      <div className="form-grid" style={{ marginTop: 8 }}>
        <div className="field"><label htmlFor="en">Name</label><input id="en" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="eh">Help text</label><input id="eh" value={v.helpText} onChange={(e) => setV({ ...v, helpText: e.target.value })} /></div>
        <div className="field"><label htmlFor="es">Section</label><input id="es" value={v.section} onChange={(e) => setV({ ...v, section: e.target.value })} /></div>
        <div className="field"><label htmlFor="eo">Order on the form</label><input id="eo" type="number" value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} /></div>
        {f.type === "numeric" && <>
          <div className="field"><label htmlFor="eu">Unit</label><input id="eu" disabled={locked} value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} /></div>
          <div className="field"><label htmlFor="emn">Lowest allowed</label><input id="emn" type="number" step="any" value={v.absMin} onChange={(e) => setV({ ...v, absMin: e.target.value })} /></div>
          <div className="field"><label htmlFor="emx">Highest allowed</label><input id="emx" type="number" step="any" value={v.absMax} onChange={(e) => setV({ ...v, absMax: e.target.value })} /></div>
        </>}
      </div>
      {f.type === "choice" && <div className="field" style={{ marginTop: 10 }}><label htmlFor="ec">Options (one per line)</label><textarea id="ec" value={v.choices} onChange={(e) => setV({ ...v, choices: e.target.value })} /></div>}
      <div className="row" style={{ gap: 18, marginTop: 10 }}>
        {["numeric", "choice", "boolean"].includes(f.type) && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="checkbox" checked={v.kind === "matching"} onChange={(e) => setV({ ...v, kind: e.target.checked ? "matching" : "info" })} />Affects matching</label>
        )}
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="checkbox" checked={v.required} onChange={(e) => setV({ ...v, required: e.target.checked })} />Required</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="checkbox" checked={v.aiVisible} onChange={(e) => setV({ ...v, aiVisible: e.target.checked })} />Allow AI assistants (Claude, Copilot) to see this field</label>
      </div>
      <div className="row" style={{ marginTop: 10 }}><button disabled={busy} onClick={save}>Save changes</button><button className="ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function Backfill({ catId, onDone }: { catId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [rep, setRep] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(true); setMsg(null);
    const form = new FormData();
    form.append("file", file); form.append("dryRun", String(dryRun));
    const r = await api(`/api/categories/${catId}/fields/backfill`, { form });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Failed" });
    setRep(r.data);
    if (r.data.applied) { setMsg({ kind: "ok", text: `${r.data.newValues + r.data.changedValues} values saved on ${r.data.products} launches.` }); onDone(); }
  }
  const writable = rep && rep.errors.length === 0 && rep.newValues + rep.changedValues > 0 && !rep.applied;

  return (
    <div className="card">
      <h2>Fill in values for existing launches</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        A new field has no values on past launches. Download the list of products, fill in the new field's column, and upload it. Only filled cells are written; empty cells never clear a value. Run data is not touched. Every change is audited.
      </p>
      <div className="row">
        <a className="btn ghost" href={`/api/categories/${catId}/fields/backfill-template`}>Download the list (CSV)</a>
        <input type="file" accept=".csv,text/csv" aria-label="Back-fill CSV file" style={{ maxWidth: 340 }} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRep(null); setMsg(null); }} />
        <button className="ghost" disabled={!file || busy} onClick={() => run(true)}>Check the file</button>
      </div>
      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      {rep && (
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 18 }}>
            <span><b>{rep.products}</b> launches</span><span><b>{rep.newValues}</b> new values</span><span><b>{rep.changedValues}</b> changed</span><span><b>{rep.unchanged}</b> unchanged</span>
          </div>
          {rep.errors.length > 0 && (
            <div className="tw" style={{ maxHeight: 260, overflowY: "auto", marginTop: 8 }}>
              <table><thead><tr><th>Row</th><th>Launch</th><th>Column</th><th>Problem</th></tr></thead>
                <tbody>{rep.errors.slice(0, 100).map((e: any, i: number) => <tr key={i}><td>{e.row ?? "–"}</td><td className="mono">{e.launch ?? "–"}</td><td className="mono">{e.field ?? "–"}</td><td>{e.message}</td></tr>)}</tbody></table>
            </div>
          )}
          {rep.warnings.length > 0 && <details style={{ marginTop: 8 }}><summary className="small" style={{ color: "var(--warn)" }}>{rep.warnings.length} note(s)</summary>
            <ul className="small">{rep.warnings.slice(0, 50).map((w: any, i: number) => <li key={i}>{w.row ? `Row ${w.row}: ` : ""}{w.message}</li>)}</ul></details>}
          {writable && <div style={{ marginTop: 10 }}><button disabled={busy} onClick={() => run(false)}>Save {rep.newValues + rep.changedValues} values</button></div>}
          {rep.errors.length > 0 && <p className="small muted">Nothing is saved while the file has errors. Fix them and check again.</p>}
        </div>
      )}
    </div>
  );
}

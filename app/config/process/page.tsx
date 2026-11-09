"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { can, type Role } from "@/lib/permissions";

type Msg = { kind: "err" | "ok" | "info" | "warn"; text: string } | null;
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "p_$1").slice(0, 40);
const blankP = { stepId: "", name: "", code: "", codeTouched: false, unit: "", absMin: "", absMax: "", isCritical: false, isLocked: false, helpText: "" };
const blankT = { name: "", code: "", codeTouched: false, unit: "", isCritical: false, helpText: "" };

export default function ProcessSetup() {
  const [role, setRole] = useState<Role | undefined>();
  const [cats, setCats] = useState<{ id: string; name: string; code: string }[]>([]);
  const [catId, setCatId] = useState("");
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [pf, setPf] = useState<any>(blankP);
  const [tf, setTf] = useState<any>(blankT);
  const [stepName, setStepName] = useState("");
  const [panel, setPanel] = useState<{ id: string; kind: "p" | "t"; mode: "edit" | "retire" } | null>(null);
  const owner = can(role, "manageProcess");

  useEffect(() => {
    api("/api/session").then((r) => r.ok && setRole(r.data.user.role));
    api("/api/launches").then((r) => { if (r.ok) { setCats(r.data.categories); setCatId(r.data.categories.find((c: any) => c.code === "UHT_DRINK")?.id ?? r.data.categories[0]?.id ?? ""); } });
  }, []);
  const load = useCallback(async () => {
    if (!catId) return;
    const r = await api(`/api/categories/${catId}/process`);
    if (r.ok) setData(r.data); else setMsg({ kind: "err", text: r.message ?? "Could not load the setup" });
  }, [catId]);
  useEffect(() => { setPanel(null); load(); }, [load]);

  async function send(body: Record<string, unknown>, ok: string) {
    setBusy(true); setMsg(null);
    const r = await api(`/api/categories/${catId}/process`, { body });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: "err", text: r.message ?? "Failed" }); return false; }
    setMsg({ kind: "ok", text: ok }); setPanel(null); load();
    return true;
  }

  const activeParams = data?.steps.flatMap((s: any) => s.parameters.filter((p: any) => p.status === "Active")) ?? [];

  return (
    <>
      <div className="eyebrow">Configuration</div>
      <h1>Process setup</h1>
      <p className="sub">
        The process steps, settings (parameters) and quality tests that trial runs record for a category, and what each line can run. Items are retired, never deleted. A new parameter or test starts with no history, and recommendations say so.
      </p>

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="field" style={{ minWidth: 280 }}><label htmlFor="pc">Category</label>
          <select id="pc" value={catId} onChange={(e) => setCatId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <Link href="/config/fields" className="small" style={{ alignSelf: "flex-end", paddingBottom: 10 }}>Product fields →</Link>
      </div>
      {role && !owner && <div className="msg info">You can see the setup. Only category owners and plant admins change it.</div>}
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}

      {data && (
        <div className="grid g4" style={{ marginBottom: 14 }}>
          <div className="card kpi"><div className="l">Process steps</div><div className="v">{data.steps.length}</div></div>
          <div className="card kpi"><div className="l">Active parameters</div><div className="v">{activeParams.length}</div></div>
          <div className="card kpi"><div className="l">Active quality tests</div><div className="v">{data.tests.filter((t: any) => t.status === "Active").length}</div></div>
          <div className="card kpi"><div className="l">Trial runs recorded</div><div className="v">{data.totalRuns}</div><div className="d">Once runs exist, ranges can only be widened</div></div>
        </div>
      )}

      <div className="card">
        <h2>Steps and parameters</h2>
        {!data && <p className="muted">Loading…</p>}
        {data?.steps.map((s: any) => (
          <div key={s.id}>
            <h3>{s.seq}. {s.name}</h3>
            <div className="tw"><table style={{ tableLayout: "fixed", minWidth: 760 }}>
              <colgroup><col style={{ width: "27%" }} /><col style={{ width: "17%" }} /><col style={{ width: "17%" }} /><col style={{ width: "13%" }} /><col style={{ width: "11%" }} />{owner && <col />}</colgroup>
              <thead><tr><th>Parameter</th><th>Allowed range</th><th>Flags</th><th>Runs with a value</th><th>Status</th>{owner && <th />}</tr></thead>
              <tbody>
                {s.parameters.length === 0 && <tr><td colSpan={6} className="muted">No parameters in this step yet.</td></tr>}
                {s.parameters.map((p: any) => {
                  const open = panel?.id === p.id && panel?.kind === "p";
                  return (
                    <Frag key={p.id}>
                      <tr>
                        <td><b>{p.name}</b><div className="mono muted">{p.code}</div>{p.helpText && <div className="small muted">{p.helpText}</div>}</td>
                        <td>{p.absMin} to {p.absMax} {p.unit}</td>
                        <td>{p.isCritical && <span className="badge b-amber">critical</span>} {p.isLocked && <span className="badge b-gray">locked limits</span>}</td>
                        <td>{p.runsWithValue}{p.runsWithValue === 0 && <div className="small muted">no history yet</div>}</td>
                        <td><span className={`badge ${p.status === "Active" ? "b-green" : "b-gray"}`}>{p.status}</span></td>
                        {owner && <td><div className="row" style={{ gap: 6 }}>
                          {p.status === "Active" && <button className="ghost small" onClick={() => setPanel(open && panel?.mode === "edit" ? null : { id: p.id, kind: "p", mode: "edit" })}>Edit</button>}
                          {p.status === "Active" && <button className="ghost small" onClick={() => setPanel({ id: p.id, kind: "p", mode: "retire" })}>Retire</button>}
                          {p.status === "Retired" && <button className="ghost small" disabled={busy} onClick={() => send({ action: "setParameterStatus", id: p.id, status: "Active" }, `"${p.name}" is active again.`)}>Reactivate</button>}
                        </div></td>}
                      </tr>
                      {open && owner && <tr><td colSpan={6} style={{ background: "var(--soft)" }}>
                        {panel!.mode === "edit" && <ParamEdit p={p} busy={busy} onSave={(patch: any) => send({ action: "updateParameter", id: p.id, patch }, `"${p.name}" updated.`)} onCancel={() => setPanel(null)} />}
                        {panel!.mode === "retire" && <RetireBox name={p.name} busy={busy} onConfirm={(reason: string) => send({ action: "setParameterStatus", id: p.id, status: "Retired", reason }, `"${p.name}" is retired. Past values are kept.`)} onCancel={() => setPanel(null)} />}
                      </td></tr>}
                    </Frag>
                  );
                })}
              </tbody>
            </table></div>
          </div>
        ))}
        {owner && data && (
          <div className="row" style={{ marginTop: 14 }}>
            <div className="field" style={{ minWidth: 240 }}><label htmlFor="ns">Add a process step</label><input id="ns" value={stepName} maxLength={40} onChange={(e) => setStepName(e.target.value)} placeholder="For example: Cooling" /></div>
            <button className="ghost" style={{ alignSelf: "flex-end" }} disabled={busy || stepName.trim().length < 2} onClick={async () => { if (await send({ action: "addStep", name: stepName }, `Step "${stepName}" added.`)) setStepName(""); }}>Add step</button>
          </div>
        )}
      </div>

      {owner && data && (
        <div className="card">
          <h2>Add a parameter</h2>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
            <div className="field"><label htmlFor="ps">Step</label>
              <select id="ps" value={pf.stepId} onChange={(e) => setPf({ ...pf, stepId: e.target.value })}><option value="">Select…</option>{data.steps.map((s: any) => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}</select></div>
            <div className="field"><label htmlFor="pn">Name</label><input id="pn" value={pf.name} maxLength={60} onChange={(e) => setPf({ ...pf, name: e.target.value, code: pf.codeTouched ? pf.code : slug(e.target.value) })} placeholder="For example: Pump speed" /></div>
            <div className="field"><label htmlFor="pcde">Code (used in files)</label><input id="pcde" className="mono" value={pf.code} maxLength={40} onChange={(e) => setPf({ ...pf, code: e.target.value, codeTouched: true })} /></div>
            <div className="field"><label htmlFor="pu">Unit</label><input id="pu" value={pf.unit} maxLength={12} onChange={(e) => setPf({ ...pf, unit: e.target.value })} placeholder="rpm" /></div>
            <div className="field"><label htmlFor="pmn">Lowest allowed</label><input id="pmn" type="number" step="any" value={pf.absMin} onChange={(e) => setPf({ ...pf, absMin: e.target.value })} /></div>
            <div className="field"><label htmlFor="pmx">Highest allowed</label><input id="pmx" type="number" step="any" value={pf.absMax} onChange={(e) => setPf({ ...pf, absMax: e.target.value })} /></div>
          </div>
          <div className="field" style={{ marginTop: 12 }}><label htmlFor="ph">Help text (optional)</label><input id="ph" value={pf.helpText} maxLength={200} onChange={(e) => setPf({ ...pf, helpText: e.target.value })} /></div>
          <div className="row" style={{ gap: 18, marginTop: 10 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="checkbox" checked={pf.isCritical} onChange={(e) => setPf({ ...pf, isCritical: e.target.checked })} />Critical parameter</label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="checkbox" checked={pf.isLocked} onChange={(e) => setPf({ ...pf, isLocked: e.target.checked })} />Locked limits (regulated or food-safety)</label>
          </div>
          <p className="small muted">Every line starts able to run the full allowed range. Narrow it per line in the capability grid below. Past runs have no value for a new parameter, so its first windows are only a starting guess, and the recommendation says so.</p>
          <button disabled={busy || !pf.stepId || !pf.name.trim() || !pf.code.trim() || !pf.unit.trim() || pf.absMin === "" || pf.absMax === ""}
            onClick={async () => { if (await send({ action: "addParameter", stepId: pf.stepId, code: pf.code, name: pf.name, unit: pf.unit, absMin: Number(pf.absMin), absMax: Number(pf.absMax), isCritical: pf.isCritical, isLocked: pf.isLocked, helpText: pf.helpText || null }, `"${pf.name}" added to every line at its full range.`)) setPf(blankP); }}>Add parameter</button>
        </div>
      )}

      {data && activeParams.length > 0 && (
        <div className="card">
          <h2>What each line can run</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Recommended settings are limited to these ranges. Edited plans outside them are refused.{owner ? "" : " Only category owners and plant admins change them."}</p>
          <div className="tw"><table>
            <thead><tr><th>Parameter</th>{data.lines.map((l: any) => <th key={l.id}>{l.name}</th>)}</tr></thead>
            <tbody>
              {data.steps.flatMap((s: any) => s.parameters.filter((p: any) => p.status === "Active")).map((p: any) => (
                <tr key={p.id}><td><b>{p.name}</b><div className="small muted">allowed {p.absMin} to {p.absMax} {p.unit}</div></td>
                  {data.lines.map((l: any) => <td key={l.id}><CapCell cap={p.capability[l.id]} p={p} editable={owner} busy={busy} onSave={(min: number, max: number) => send({ action: "setCapability", lineId: l.id, parameterId: p.id, min, max }, `${l.name}: ${p.name} can run ${min} to ${max} ${p.unit}.`)} /></td>)}
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {data && (
        <div className="card">
          <h2>Quality tests</h2>
          <div className="tw"><table>
            <thead><tr><th>Test</th><th>Unit</th><th>Role</th><th>Results recorded</th><th>Status</th>{owner && <th />}</tr></thead>
            <tbody>
              {data.tests.map((t: any) => {
                const open = panel?.id === t.id && panel?.kind === "t";
                return (
                  <Frag key={t.id}>
                    <tr>
                      <td><b>{t.name}</b><div className="mono muted">{t.code}</div>{t.helpText && <div className="small muted">{t.helpText}</div>}</td>
                      <td>{t.unit ?? "–"}</td>
                      <td>{t.isCritical ? <span className="badge b-amber">critical: decides pass or fail</span> : <span className="badge b-gray">non-critical</span>}</td>
                      <td>{t.results}</td>
                      <td><span className={`badge ${t.status === "Active" ? "b-green" : "b-gray"}`}>{t.status}</span></td>
                      {owner && <td><div className="row" style={{ gap: 6 }}>
                        {t.status === "Active" && <button className="ghost small" onClick={() => setPanel(open && panel?.mode === "edit" ? null : { id: t.id, kind: "t", mode: "edit" })}>Edit</button>}
                        {t.status === "Active" && <button className="ghost small" onClick={() => setPanel({ id: t.id, kind: "t", mode: "retire" })}>Retire</button>}
                        {t.status === "Retired" && <button className="ghost small" disabled={busy} onClick={() => send({ action: "setTestStatus", id: t.id, status: "Active" }, `"${t.name}" is active again.`)}>Reactivate</button>}
                      </div></td>}
                    </tr>
                    {open && owner && <tr><td colSpan={6} style={{ background: "var(--soft)" }}>
                      {panel!.mode === "edit" && <TestEdit t={t} busy={busy} onSave={(patch: any) => send({ action: "updateTest", id: t.id, patch }, `"${t.name}" updated.`)} onCancel={() => setPanel(null)} />}
                      {panel!.mode === "retire" && <RetireBox name={t.name} busy={busy} onConfirm={(reason: string) => send({ action: "setTestStatus", id: t.id, status: "Retired", reason }, `"${t.name}" is retired. Past results are kept.`)} onCancel={() => setPanel(null)} />}
                    </td></tr>}
                  </Frag>
                );
              })}
            </tbody>
          </table></div>
          {owner && (
            <>
              <h3>Add a quality test</h3>
              <div className="form-grid">
                <div className="field"><label htmlFor="tn">Name</label><input id="tn" value={tf.name} maxLength={60} onChange={(e) => setTf({ ...tf, name: e.target.value, code: tf.codeTouched ? tf.code : slug(e.target.value) })} placeholder="For example: Colour (L*)" /></div>
                <div className="field"><label htmlFor="tc">Code (used in files)</label><input id="tc" className="mono" value={tf.code} maxLength={40} onChange={(e) => setTf({ ...tf, code: e.target.value, codeTouched: true })} /></div>
                <div className="field"><label htmlFor="tu">Unit (optional)</label><input id="tu" value={tf.unit} maxLength={12} onChange={(e) => setTf({ ...tf, unit: e.target.value })} /></div>
              </div>
              <div className="row" style={{ gap: 18, margin: "10px 0" }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="checkbox" checked={tf.isCritical} onChange={(e) => setTf({ ...tf, isCritical: e.target.checked })} />Critical: a result out of spec fails the run</label>
              </div>
              <p className="small muted">Targets (minimum and maximum) are set per product on the New launch form. Older products have no target for a new test, which is fine.</p>
              <button disabled={busy || !tf.name.trim() || !tf.code.trim()} onClick={async () => { if (await send({ action: "addTest", code: tf.code, name: tf.name, unit: tf.unit || null, isCritical: tf.isCritical }, `"${tf.name}" added.`)) setTf(blankT); }}>Add test</button>
            </>
          )}
        </div>
      )}
    </>
  );
}

function Frag({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function CapCell({ cap, p, editable, busy, onSave }: any) {
  const [mn, setMn] = useState(String(cap?.min ?? p.absMin));
  const [mx, setMx] = useState(String(cap?.max ?? p.absMax));
  const dirty = Number(mn) !== (cap?.min ?? p.absMin) || Number(mx) !== (cap?.max ?? p.absMax);
  if (!editable) return <span>{cap ? `${cap.min} to ${cap.max}` : "–"}</span>;
  return (
    <div style={{ minWidth: 150 }}>
      <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
        <input aria-label={`${p.name} lowest`} type="number" step="any" value={mn} onChange={(e) => setMn(e.target.value)} style={{ padding: "4px 6px" }} />
        <input aria-label={`${p.name} highest`} type="number" step="any" value={mx} onChange={(e) => setMx(e.target.value)} style={{ padding: "4px 6px" }} />
      </div>
      {dirty && <button className="small" style={{ marginTop: 4 }} disabled={busy} onClick={() => onSave(Number(mn), Number(mx))}>Save</button>}
    </div>
  );
}

function RetireBox({ name, busy, onConfirm, onCancel }: any) {
  const [reason, setReason] = useState("");
  return (
    <div>
      <b>Retire "{name}"</b>
      <p style={{ margin: "6px 0" }}>Past values are kept. It disappears from forms, templates, imports and recommendations, and can be reactivated. It is never deleted.</p>
      <div className="field" style={{ maxWidth: 360 }}><label htmlFor="rr2">Reason (required)</label><input id="rr2" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="row" style={{ marginTop: 8 }}><button className="danger" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason)}>Retire</button><button className="ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function ParamEdit({ p, busy, onSave, onCancel }: any) {
  const [v, setV] = useState<any>({ name: p.name, helpText: p.helpText ?? "", absMin: p.absMin, absMax: p.absMax, isCritical: p.isCritical, isLocked: p.isLocked });
  const save = () => {
    const patch: any = {};
    if (v.name !== p.name) patch.name = v.name;
    if (v.helpText !== (p.helpText ?? "")) patch.helpText = v.helpText || null;
    if (Number(v.absMin) !== p.absMin) patch.absMin = Number(v.absMin);
    if (Number(v.absMax) !== p.absMax) patch.absMax = Number(v.absMax);
    if (v.isCritical !== p.isCritical) patch.isCritical = v.isCritical;
    if (v.isLocked !== p.isLocked) patch.isLocked = v.isLocked;
    onSave(patch);
  };
  return (
    <div>
      <b>Edit "{p.name}"</b>
      {p.runsWithValue > 0 && <p className="small muted" style={{ margin: "4px 0" }}>{p.runsWithValue} runs have a value. The code and unit are fixed and the range can only be widened.</p>}
      <div className="form-grid" style={{ marginTop: 8 }}>
        <div className="field"><label htmlFor="epn">Name</label><input id="epn" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="eph">Help text</label><input id="eph" value={v.helpText} onChange={(e) => setV({ ...v, helpText: e.target.value })} /></div>
        <div className="field"><label htmlFor="epmn">Lowest allowed</label><input id="epmn" type="number" step="any" value={v.absMin} onChange={(e) => setV({ ...v, absMin: e.target.value })} /></div>
        <div className="field"><label htmlFor="epmx">Highest allowed</label><input id="epmx" type="number" step="any" value={v.absMax} onChange={(e) => setV({ ...v, absMax: e.target.value })} /></div>
      </div>
      <div className="row" style={{ gap: 18, marginTop: 10 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="checkbox" checked={v.isCritical} onChange={(e) => setV({ ...v, isCritical: e.target.checked })} />Critical</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5 }}><input type="checkbox" checked={v.isLocked} onChange={(e) => setV({ ...v, isLocked: e.target.checked })} />Locked limits</label>
      </div>
      <div className="row" style={{ marginTop: 10 }}><button disabled={busy} onClick={save}>Save changes</button><button className="ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function TestEdit({ t, busy, onSave, onCancel }: any) {
  const [v, setV] = useState<any>({ name: t.name, unit: t.unit ?? "", helpText: t.helpText ?? "", isCritical: t.isCritical });
  const save = () => {
    const patch: any = {};
    if (v.name !== t.name) patch.name = v.name;
    if (v.unit !== (t.unit ?? "")) patch.unit = v.unit || null;
    if (v.helpText !== (t.helpText ?? "")) patch.helpText = v.helpText || null;
    if (v.isCritical !== t.isCritical) patch.isCritical = v.isCritical;
    onSave(patch);
  };
  return (
    <div>
      <b>Edit "{t.name}"</b>
      {t.results > 0 && <p className="small muted" style={{ margin: "4px 0" }}>{t.results} results exist, so the code and unit are fixed.</p>}
      <div className="form-grid" style={{ marginTop: 8 }}>
        <div className="field"><label htmlFor="etn">Name</label><input id="etn" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="etu">Unit</label><input id="etu" disabled={t.results > 0} value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} /></div>
        <div className="field"><label htmlFor="eth">Help text</label><input id="eth" value={v.helpText} onChange={(e) => setV({ ...v, helpText: e.target.value })} /></div>
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 13.5, marginTop: 10 }}><input type="checkbox" checked={v.isCritical} onChange={(e) => setV({ ...v, isCritical: e.target.checked })} />Critical</label>
      <div className="row" style={{ marginTop: 10 }}><button disabled={busy} onClick={save}>Save changes</button><button className="ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

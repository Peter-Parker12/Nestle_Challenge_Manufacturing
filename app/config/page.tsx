"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { can, type Role } from "@/lib/permissions";
import { LEVEL_LABELS } from "@/lib/engine/weights";

export default function Config() {
  const [role, setRole] = useState<Role | undefined>();
  const [cats, setCats] = useState<any[]>([]);
  const [catId, setCatId] = useState("");
  const [cfg, setCfg] = useState<any>(null);
  const [draft, setDraft] = useState<{ attributes: Record<string, number>; parameters: Record<string, number> }>({ attributes: {}, parameters: {} });
  const [reason, setReason] = useState("");
  const [sugg, setSugg] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/session").then((r) => r.ok && setRole(r.data.user.role));
    api("/api/launches").then((r) => { if (r.ok) { setCats(r.data.categories); setCatId(r.data.categories.find((c: any) => c.code === "UHT_DRINK")?.id ?? r.data.categories[0]?.id ?? ""); } });
  }, []);
  const load = useCallback(async () => {
    if (!catId) return;
    const r = await api(`/api/categories/${catId}/config`);
    if (r.ok) { setCfg(r.data); setDraft({ attributes: {}, parameters: {} }); }
    const s = await api("/api/rule-suggestions");
    if (s.ok) setSugg(s.data.suggestions);
  }, [catId]);
  useEffect(() => { load(); }, [load]);

  const lvl = (kind: "attributes" | "parameters", code: string) => draft[kind][code] ?? cfg?.categoryWeights?.[kind]?.[code] ?? 3;
  const dirty = Object.keys(draft.attributes).length + Object.keys(draft.parameters).length > 0;
  const owner = can(role, "categoryWeights");

  async function saveWeights() {
    setBusy(true); setMsg(null);
    const full = {
      attributes: Object.fromEntries(cfg.attrDefs.map((a: any) => [a.code, lvl("attributes", a.code)])),
      parameters: Object.fromEntries(cfg.paramDefs.map((p: any) => [p.code, lvl("parameters", p.code)])),
    };
    const r = await api(`/api/categories/${catId}/weights`, { body: { ...full, reason } });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Failed" });
    setReason(""); setMsg({ kind: "ok", text: "Category defaults saved. They apply to new recommendations." }); load();
  }
  async function suggest() {
    setBusy(true); setMsg(null);
    const r = await api("/api/ai/suggest-rules", { body: { categoryId: catId } });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.error === "ai_unavailable" ? "Needs the Claude API (no key configured)." : r.message ?? "Failed" });
    setMsg({ kind: "ok", text: `${r.data.count} candidate rule(s) proposed. Review them below.` }); load();
  }
  async function decide(id: string, accept: boolean) {
    setBusy(true);
    const r = await api(`/api/ai/rule-suggestions/${id}`, { body: { accept } });
    setBusy(false);
    if (!r.ok) setMsg({ kind: "err", text: r.message ?? "Failed" }); else load();
  }

  return (
    <>
      <h1>Configuration</h1>
      <p className="sub">Parameters, limits, default weights and expert rules for a product category. A new category is added here with no code change.</p>
      <div className="field" style={{ maxWidth: 320, marginBottom: 14 }}>
        <label htmlFor="cc">Category</label>
        <select id="cc" value={catId} onChange={(e) => setCatId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      {cfg && (
        <>
          <div className="grid g2">
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>Product fields used for matching</h2><a className="small" href="/config/fields">Manage fields →</a></div>
              <div className="tw"><table><thead><tr><th>Attribute</th><th>Type</th><th>Allowed</th><th>Default weight</th></tr></thead><tbody>
                {cfg.attrDefs.filter((a: any) => (a.kind ?? "matching") === "matching" && ["numeric", "choice", "boolean"].includes(a.type)).map((a: any) => (
                  <tr key={a.code}><td>{a.name}{a.required ? " *" : ""}</td><td>{a.type}</td><td className="muted">{a.type === "numeric" ? `${a.absMin} to ${a.absMax} ${a.unit ?? ""}` : a.choices?.join(", ")}</td>
                    <td><select aria-label={`${a.name} default weight`} disabled={!owner} value={lvl("attributes", a.code)} onChange={(e) => setDraft({ ...draft, attributes: { ...draft.attributes, [a.code]: Number(e.target.value) } })}>
                      {LEVEL_LABELS.map((l, i) => <option key={l} value={i}>{i} · {l}</option>)}</select></td></tr>
                ))}
              </tbody></table></div>
            </div>
            <div className="card">
              <h2>Process parameters</h2>
              <div className="tw"><table><thead><tr><th>Parameter</th><th>Range</th><th>Flags</th><th>Default weight</th></tr></thead><tbody>
                {cfg.paramDefs.map((p: any) => (
                  <tr key={p.code}><td>{p.name}</td><td className="muted">{p.absMin} to {p.absMax} {p.unit}</td>
                    <td>{p.isCritical && <span className="badge b-amber">critical</span>} {p.isLocked && <span className="badge b-gray">locked</span>}</td>
                    <td><select aria-label={`${p.name} default weight`} disabled={!owner} value={lvl("parameters", p.code)} onChange={(e) => setDraft({ ...draft, parameters: { ...draft.parameters, [p.code]: Number(e.target.value) } })}>
                      {LEVEL_LABELS.map((l, i) => <option key={l} value={i}>{i} · {l}</option>)}</select></td></tr>
                ))}
              </tbody></table></div>
            </div>
          </div>
          {owner ? dirty && (
            <div className="card">
              <div className="field"><label htmlFor="cr">Reason for changing the category defaults (required, logged)</label><input id="cr" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
              <div style={{ marginTop: 8 }}><button disabled={busy || !reason.trim()} onClick={saveWeights}>Save category defaults</button></div>
            </div>
          ) : <p className="small muted">Only the category owner changes the defaults. Switch to the category owner to try it.</p>}

          <div className="card">
            <h2>Expert (SME) rules</h2>
            <div className="tw"><table><thead><tr><th>Condition</th><th>Severity</th><th>Warning shown</th><th>Status</th></tr></thead><tbody>
              {cfg.rules.length === 0 && <tr><td colSpan={4} className="muted">No rules for this category.</td></tr>}
              {cfg.rules.map((r: any) => (
                <tr key={r.id}><td className="mono">{r.condition.attr} {r.condition.op} {String(r.condition.value)}</td><td>{r.risk_effect.severity}</td><td>{r.message}</td><td><span className="badge b-gray">{r.status}</span></td></tr>
              ))}
            </tbody></table></div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div><h2 style={{ margin: 0 }}>Rule suggestions from failure patterns</h2><div className="small muted">Claude proposes candidate rules from the rework history. A category owner accepts or rejects each one.</div></div>
              {owner && <button className="ghost" disabled={busy} onClick={suggest}>Look for patterns</button>}
            </div>
            <div className="tw"><table><thead><tr><th>Proposed rule</th><th>Why</th><th>Evidence</th><th /></tr></thead><tbody>
              {sugg.length === 0 && <tr><td colSpan={4} className="muted">No suggestions yet.</td></tr>}
              {sugg.map((s) => (
                <tr key={s.id}><td><span className="mono">{s.draft_condition.attr} {s.draft_condition.op} {s.draft_condition.value}</span><div className="small">{s.draft_condition.message}</div></td>
                  <td className="small">{s.rationale}</td><td className="small mono">{s.evidence_codes.join(", ")}</td>
                  <td>{s.status === "Proposed" ? (owner ? <div className="row"><button disabled={busy} onClick={() => decide(s.id, true)}>Accept</button><button className="ghost" disabled={busy} onClick={() => decide(s.id, false)}>Reject</button></div> : <span className="small muted">awaiting owner</span>) : <span className="badge b-gray">{s.status}</span>}</td></tr>
              ))}
            </tbody></table></div>
          </div>
        </>
      )}
    </>
  );
}

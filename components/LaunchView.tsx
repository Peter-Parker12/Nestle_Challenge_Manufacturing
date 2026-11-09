"use client";
import { useCallback, useEffect, useState } from "react";
import { api, badge } from "./api";
import { can, type Role } from "@/lib/permissions";
import { LEVEL_LABELS } from "@/lib/engine/weights";

type Msg = { kind: "err" | "ok" | "info" | "warn"; text: string } | null;
const STEPS = ["Draft", "Recommended", "Approved", "Trial running", "Results entered", "Closed"];

export default function LaunchView({ id, role }: { id: string; role: Role }) {
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [aiOn, setAiOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api(`/api/launches/${id}`);
    if (r.ok) setD(r.data);
    else setMsg({ kind: "err", text: r.message ?? "Could not load the launch" });
  }, [id]);
  useEffect(() => { load(); api("/api/ai/status").then((s) => setAiOn(!!s.data?.enabled)); }, [load]);

  const act = async (fn: () => Promise<{ ok: boolean; message?: string; data?: any }>, okText?: string) => {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setMsg({ kind: "err", text: r.message ?? "Something went wrong" });
    else if (okText) setMsg({ kind: "ok", text: okText });
    await load();
    return r;
  };

  if (!d) return <p className="muted">{msg ? msg.text : "Loading…"}</p>;
  const L = d.launch;
  const open = !["Closed", "Cancelled"].includes(L.status);
  const latestRec = d.recommendations[0];
  const stepIdx = L.status === "In review" ? 1 : STEPS.indexOf(L.status);
  const lastRun = d.runs[d.runs.length - 1];
  const paramName = (c: string) => d.paramDefs.find((p: any) => p.code === c);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1><span className="mono">{L.code}</span> · {L.productName}</h1>
          <p className="sub" style={{ marginBottom: 6 }}>{L.category} · {L.line} · {L.objective ?? "No objective set"}</p>
        </div>
        <div className="row">
          <span className={`badge ${badge(L.status)}`}>{L.status}</span>
          {L.taDecision && <span className={`badge ${badge(L.taDecision)}`}>Technical acceptance: {L.taDecision}</span>}
        </div>
      </div>

      {L.status === "Cancelled" ? (
        <div className="msg warn">Cancelled: {L.cancelReason}</div>
      ) : (
        <div className="steps" aria-label="Progress">
          {STEPS.map((s, i) => <span key={s} className={`step ${i < stepIdx ? "done" : i === stepIdx ? "now" : ""}`}>{s}</span>)}
        </div>
      )}
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}

      <div className="card">
        <h2>Product</h2>
        <div className="form-grid">
          {d.attrDefs.map((a: any) => (
            <div key={a.code}><div className="small muted">{a.name}</div><div>{d.attrs[a.code] ?? "–"} {a.unit ?? ""}</div></div>
          ))}
        </div>
        <h3>Quality targets</h3>
        <div className="row small">
          {d.specs.map((s: any) => (
            <span key={s.code} className="badge b-gray">{s.name}: {s.spec_min ?? "–"} to {s.spec_max ?? "–"}{s.is_critical ? " (critical)" : ""}</span>
          ))}
        </div>
      </div>

      {open && <WeightsPanel d={d} id={id} role={role} busy={busy} act={act} />}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Recommendation</h2>
          {open && can(role, "recommend") && (
            <button disabled={busy} onClick={() => act(() => api(`/api/launches/${id}/recommend`, { method: "POST" }), "New recommendation created from the current weights and history.")}>
              {latestRec ? "Recommend again" : "Generate recommendation"}
            </button>
          )}
        </div>
        {!latestRec && <p className="muted">No recommendation yet. It uses {d.attrDefs.length} product attributes, the weights above, and every accepted launch in this category.</p>}
        {latestRec && <RecView d={d} rec={latestRec} id={id} role={role} busy={busy} act={act} aiOn={aiOn} paramName={paramName} open={open} />}
        {d.recommendations.length > 1 && (
          <details style={{ marginTop: 12 }}>
            <summary className="small muted">Earlier recommendations ({d.recommendations.length - 1})</summary>
            {d.recommendations.slice(1).map((r: any) => (
              <div key={r.id} className="small" style={{ padding: "6px 0" }}>
                For run {r.runNoTarget}, {new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")}: confidence {r.confidence}, risk {r.overallRisk}, decision {r.decision ? r.decision.action : "none"}.
              </div>
            ))}
          </details>
        )}
      </div>

      <div className="card">
        <h2>Trial runs</h2>
        {d.runs.length === 0 && <p className="muted">No runs yet. Approving a recommendation creates run 1.</p>}
        {d.runs.map((r: any) => <RunCard key={r.id} d={d} run={r} role={role} busy={busy} act={act} paramName={paramName} />)}
        {d.runs.length >= 2 && <Compare d={d} />}
      </div>

      {open && lastRun?.status === "Closed" && lastRun.result === "Pass" && lastRun.nextStep === "TA" && (
        <div className="card">
          <h2>Technical acceptance</h2>
          <p className="muted" style={{ marginTop: 0 }}>Run {lastRun.runNo} passed and was sent for acceptance. Only QA records the decision.</p>
          {can(role, "recordTA") ? (
            <div className="row">
              {["Accepted", "Accepted with conditions", "Rejected"].map((x) => (
                <button key={x} className={x === "Rejected" ? "danger" : x === "Accepted" ? "" : "ghost"} disabled={busy}
                  onClick={() => act(() => api(`/api/launches/${id}/ta`, { body: { decision: x } }), `Technical acceptance recorded: ${x}. The launch is now closed and joins the history.`)}>{x}</button>
              ))}
            </div>
          ) : <p className="small muted">Switch to a QA user to record the decision.</p>}
        </div>
      )}

      {open && can(role, "extraction") && <ImportPanel d={d} id={id} aiOn={aiOn} reload={load} />}

      {open && can(role, "cancelLaunch") && <CancelPanel id={id} busy={busy} act={act} />}
    </>
  );
}

/* ---------------------------------------------------------------- weights */
function WeightsPanel({ d, id, role, busy, act }: any) {
  const [draft, setDraft] = useState<{ attributes: Record<string, number>; parameters: Record<string, number> }>({ attributes: {}, parameters: {} });
  const [reason, setReason] = useState("");
  const [cmp, setCmp] = useState<any>(null);
  const [err, setErr] = useState("");
  const base = d.weights.levels;
  const cur = (kind: "attributes" | "parameters", code: string) => draft[kind][code] ?? base[kind][code];
  const dirty = Object.keys(draft.attributes).length + Object.keys(draft.parameters).length > 0;
  const editable = can(role, "setRecipeWeights");
  const srcLabel = (kind: "attributes" | "parameters", code: string) => d.weights.source[kind][code];
  const criticals = [...Object.keys(base.attributes).map((c) => cur("attributes", c)), ...Object.keys(base.parameters).map((c) => cur("parameters", c))].filter((v) => v >= 5).length;

  const row = (kind: "attributes" | "parameters", code: string, name: string) => (
    <div key={`${kind}-${code}`} className="field">
      <label htmlFor={`w-${code}`}>{name} <span className="badge b-gray">{srcLabel(kind, code)}</span></label>
      <select id={`w-${code}`} disabled={!editable} value={cur(kind, code)}
        onChange={(e) => { setCmp(null); setDraft({ ...draft, [kind]: { ...draft[kind], [code]: Number(e.target.value) } }); }}>
        {LEVEL_LABELS.map((l, i) => <option key={l} value={i}>{i} · {l}</option>)}
      </select>
    </div>
  );

  async function preview() {
    setErr("");
    const r = await api(`/api/launches/${id}/compare`, { body: draft });
    if (r.ok) setCmp(r.data); else setErr(r.message ?? "Failed");
  }
  async function save() {
    setErr("");
    if (!reason.trim()) return setErr("Enter a reason. Weight changes are logged with who and why.");
    const r = await act(() => api(`/api/launches/${id}/weights`, { body: { ...draft, parameters: draft.parameters, reason } }), "Weights saved for this recipe. Generate a new recommendation to use them.");
    if (r.ok) { setDraft({ attributes: {}, parameters: {} }); setReason(""); setCmp(null); }
  }

  return (
    <details className="card" open={dirty}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Weights: what counts as “similar” and what matters most</summary>
      <p className="small muted">0 means ignore, 5 means critical. Category defaults are set by the category owner. Changes for this recipe need a reason.</p>
      <h3>Product attributes (which past launches are similar)</h3>
      <div className="form-grid">{d.attrDefs.map((a: any) => row("attributes", a.code, a.name))}</div>
      <h3>Process parameters (how tight the window is)</h3>
      <div className="form-grid">{d.paramDefs.map((p: any) => row("parameters", p.code, p.name))}</div>
      {criticals > 2 && <div className="msg warn">More than two items are Critical. When everything is critical, nothing stands out.</div>}
      {dirty && editable && (
        <>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="ghost" disabled={busy} onClick={preview}>Preview the effect</button>
            <button className="ghost" disabled={busy} onClick={() => { setDraft({ attributes: {}, parameters: {} }); setCmp(null); }}>Reset</button>
          </div>
          {cmp && (
            <div className="grid g2" style={{ marginTop: 10 }}>
              {(["current", "proposed"] as const).map((k) => (
                <div key={k} className="card">
                  <strong>{k === "current" ? "Current weights" : "Your weights"}</strong>
                  <div className="small">Matches {cmp[k].nMatched} · confidence {cmp[k].confidence} · risk {cmp[k].overallRisk}</div>
                  <div className="small muted">Nearest: {cmp[k].neighbours.map((n: any) => `${n.code} (${n.similarity})`).join(", ")}</div>
                  <table className="small"><tbody>{cmp[k].lines.map((l: any) => <tr key={l.code}><td>{l.code}</td><td>{l.startValue}</td><td className="muted">{l.windowLow} to {l.windowHigh}</td></tr>)}</tbody></table>
                  {cmp[k].warnings.map((w: string) => <div key={w} className="msg warn">{w}</div>)}
                </div>
              ))}
            </div>
          )}
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="wr">Reason for the change (required)</label>
            <input id="wr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: fat drives creaming on this recipe" />
          </div>
          {err && <div className="msg err">{err}</div>}
          <div style={{ marginTop: 10 }}><button disabled={busy} onClick={save}>Save weights for this recipe</button></div>
        </>
      )}
      {!editable && <p className="small muted">Your role cannot change recipe weights.</p>}
    </details>
  );
}

/* ---------------------------------------------------------------- recommendation */
function RecView({ d, rec, id, role, busy, act, aiOn, paramName, open }: any) {
  const [expl, setExpl] = useState<any>(null);
  const [eBusy, setEBusy] = useState(false);
  const [action, setAction] = useState<"approved" | "edited" | "rejected">("approved");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const decided = !!rec.decision;
  const caps = d.lineCaps;

  async function explain(refresh = false) {
    setEBusy(true);
    const r = await api(`/api/launches/${id}/recommendations/${rec.id}/explain`, { body: { refresh } });
    setEBusy(false);
    if (r.ok) setExpl(r.data); else setExpl({ error: r.message });
  }
  useEffect(() => { setExpl(null); setAction("approved"); setVals({}); setReason(""); setErr(""); }, [rec.id]);

  async function decide() {
    setErr("");
    const body: any = { action, reason: reason || undefined };
    if (action === "edited") body.finalValues = Object.fromEntries(rec.lines.map((l: any) => [l.code, Number(vals[l.code] ?? l.startValue)]));
    const r = await act(() => api(`/api/launches/${id}/recommendations/${rec.id}/decision`, { body }),
      action === "rejected" ? "Recommendation rejected. Adjust the weights or inputs and generate a new one." : "Plan approved. Run created. The process engineer can start it.");
    if (!r.ok) setErr(r.message ?? "");
  }

  return (
    <>
      <div className="row" style={{ margin: "8px 0" }}>
        <span className={`badge ${badge(rec.confidence === "High" ? "Low" : rec.confidence === "Low" ? "High" : "Medium")}`}>Confidence {rec.confidence}</span>
        <span className={`badge ${badge(rec.overallRisk)}`}>Risk {rec.overallRisk}</span>
        <span className="small muted">for run {rec.runNoTarget} · {rec.nMatched} similar launches · engine {rec.engineVersion}</span>
      </div>

      <div className="tw">
        <table>
          <thead><tr><th>Parameter</th><th>Start</th><th>Window</th><th>Position in line capability</th></tr></thead>
          <tbody>
            {rec.lines.map((l: any) => {
              const p = paramName(l.code);
              const cap = caps[l.code] ?? { min: p.absMin, max: p.absMax };
              const span = cap.max - cap.min || 1;
              const pct = (v: number) => Math.max(0, Math.min(100, ((v - cap.min) / span) * 100));
              return (
                <tr key={l.code}>
                  <td>{p.name}{p.isLocked && <span className="badge b-gray" style={{ marginLeft: 6 }}>locked limits</span>}</td>
                  <td><strong>{l.startValue}</strong> {p.unit}</td>
                  <td className="muted">{l.windowLow} to {l.windowHigh}{l.clipped && <div className="small" style={{ color: "var(--amber)" }}>{l.clipReason}</div>}</td>
                  <td style={{ minWidth: 170 }}>
                    <div className="track" role="img" aria-label={`${p.name} window ${l.windowLow} to ${l.windowHigh} within ${cap.min} to ${cap.max}`}>
                      <div className="win" style={{ left: `${pct(l.windowLow)}%`, width: `${Math.max(2, pct(l.windowHigh) - pct(l.windowLow))}%` }} />
                      <div className="pt" style={{ left: `${pct(l.startValue)}%` }} />
                    </div>
                    <div className="small muted">{cap.min} to {cap.max}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3>Risk flags</h3>
      {rec.flags.length === 0 && <p className="muted small">No risk flags.</p>}
      {rec.flags.map((f: any, i: number) => (
        <div key={i} className={`flag ${f.severity}`}><span className={`badge ${badge(f.severity)}`}>{f.severity}</span> <span className="small muted">{f.type.replace(/_/g, " ")}</span><div>{f.message}</div></div>
      ))}

      <h3>Evidence: the past launches behind this plan</h3>
      <div className="tw">
        <table>
          <thead><tr><th>#</th><th>Launch</th><th>Product</th><th>Similarity</th><th>First run</th></tr></thead>
          <tbody>
            {rec.evidence.map((e: any) => (
              <tr key={e.launchId}><td>{e.rank}</td><td><a className="mono" href={`/launches/${e.launchId}`}>{e.code}</a></td><td>{e.productName}</td><td>{e.similarity}</td>
                <td><span className={`badge ${e.wasGood ? "b-green" : "b-amber"}`}>{e.wasGood ? "passed" : "needed rework"}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">Weights used: {Object.entries(rec.weights?.normalised?.attributes ?? {}).map(([k, v]: any) => `${k} ${Math.round(v * 100)}%`).join(", ")}</p>

      <div className="row" style={{ margin: "10px 0" }}>
        <button className="ghost" disabled={eBusy || !can(role, "useAi")} onClick={() => explain(false)}>{eBusy ? "Explaining…" : "Explain this recommendation"}</button>
        {!aiOn && <span className="small muted">No API key: you get the standard explanation, written by the system without Claude.</span>}
      </div>
      {expl?.error && <div className="msg err">{expl.error}</div>}
      {expl && !expl.error && (
        <div className="quote">
          <div className="small muted">{expl.source === "claude" ? "Written by Claude from the numbers above" : "Standard explanation"}{expl.cached ? " (saved)" : ""}</div>
          <p style={{ margin: "6px 0" }}>{expl.summary}</p>
          <ul style={{ margin: "6px 0", paddingLeft: 20 }}>{expl.key_points?.map((k: any, i: number) => <li key={i}>{k.text} {k.evidence_codes?.map((c: string) => <span key={c} className="badge b-gray mono" style={{ marginRight: 4 }}>{c}</span>)}</li>)}</ul>
          {expl.watch_outs?.length > 0 && <><strong className="small">Watch out for</strong><ul style={{ margin: "4px 0", paddingLeft: 20 }}>{expl.watch_outs.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></>}
          {expl.unverified_numbers?.length > 0 && <div className="msg warn">These numbers in the text are not in the data and should be ignored: {expl.unverified_numbers.join(", ")}</div>}
          {expl.invalid_citations?.length > 0 && <div className="msg warn">These citations are not in the evidence: {expl.invalid_citations.join(", ")}</div>}
          {expl.source === "claude" && <button className="ghost small" onClick={() => explain(true)}>Regenerate</button>}
        </div>
      )}

      {decided ? (
        <div className="msg info">Decision: {rec.decision.action} by {rec.decision.by}{rec.decision.reason ? ` · “${rec.decision.reason}”` : ""}</div>
      ) : open && can(role, "decide") ? (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Your decision</h3>
          <div className="row">
            {(["approved", "edited", "rejected"] as const).map((a) => (
              <label key={a} style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", fontSize: 14 }}>
                <input type="radio" style={{ width: "auto" }} name="act" checked={action === a} onChange={() => setAction(a)} />
                {a === "approved" ? "Approve as is" : a === "edited" ? "Approve with edits" : "Reject"}
              </label>
            ))}
          </div>
          {action === "edited" && (
            <div className="form-grid" style={{ marginTop: 8 }}>
              {rec.lines.map((l: any) => {
                const p = paramName(l.code); const cap = caps[l.code];
                return (
                  <div key={l.code} className="field">
                    <label htmlFor={`ev-${l.code}`}>{p.name} ({p.unit}){cap ? ` · limit ${cap.min} to ${cap.max}` : ""}</label>
                    <input id={`ev-${l.code}`} type="number" step="any" value={vals[l.code] ?? l.startValue} onChange={(e) => setVals({ ...vals, [l.code]: e.target.value })} />
                  </div>
                );
              })}
            </div>
          )}
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="dr">Reason {rec.confidence === "Low" && action !== "rejected" ? "(required: confidence is Low)" : "(optional)"}</label>
            <textarea id="dr" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {err && <div className="msg err">{err}</div>}
          <button disabled={busy} className={action === "rejected" ? "danger" : ""} onClick={decide}>{action === "rejected" ? "Reject recommendation" : "Record decision and create run"}</button>
        </div>
      ) : open && <p className="small muted">Your role cannot decide on recommendations.</p>}
    </>
  );
}

/* ---------------------------------------------------------------- runs */
function RunCard({ d, run, role, busy, act, paramName }: any) {
  const [res, setRes] = useState<any>({ actuals: {}, quality: {}, loss: "", aborted: false, notes: "" });
  const [rev, setRev] = useState<any>({ reasons: [] as string[], nextStep: "TA", override: "", overrideReason: "", comment: "" });
  const [err, setErr] = useState("");
  const q = (code: string) => d.specs.find((s: any) => s.code === code);

  async function submitResults() {
    setErr("");
    const actuals = Object.fromEntries(d.paramDefs.map((p: any) => [p.code, Number(res.actuals[p.code] ?? run.params.find((x: any) => x.code === p.code)?.planned)]).filter(([, v]: any) => Number.isFinite(v)));
    const quality = Object.fromEntries(Object.entries(res.quality).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]));
    const r = await act(() => api(`/api/runs/${run.id}/results`, { body: { actuals, quality, lossKg: res.loss === "" ? null : Number(res.loss), aborted: res.aborted, notes: res.notes || undefined } }), "Results saved and the outcome calculated.");
    if (!r.ok) setErr(r.message ?? "");
  }
  async function submitReview() {
    setErr("");
    const r = await act(() => api(`/api/runs/${run.id}/review`, { body: { reasons: rev.reasons, nextStep: rev.nextStep, overrideResult: rev.override || undefined, overrideReason: rev.overrideReason || undefined, comment: rev.comment || undefined } }), "Run reviewed.");
    if (!r.ok) setErr(r.message ?? "");
  }

  return (
    <div className="card" style={{ background: "var(--bg)" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Run {run.runNo}</strong>
        <div className="row">
          <span className="badge b-gray">{run.status}</span>
          {run.result && <span className={`badge ${badge(run.result)}`}>{run.result}{run.overridden ? " (overridden)" : ""}</span>}
          {run.nextStep && <span className="badge b-gray">next: {run.nextStep}</span>}
        </div>
      </div>

      <div className="tw">
        <table>
          <thead><tr><th>Parameter</th><th>Planned</th><th>Actual</th></tr></thead>
          <tbody>{run.params.map((p: any) => <tr key={p.code}><td>{paramName(p.code)?.name}</td><td>{p.planned ?? "–"}</td><td>{p.actual ?? "–"}</td></tr>)}</tbody>
        </table>
      </div>
      {run.quality.length > 0 && (
        <div className="tw">
          <table>
            <thead><tr><th>Quality test</th><th>Value</th><th>Spec</th><th>Pass</th></tr></thead>
            <tbody>{run.quality.map((x: any) => <tr key={x.code}><td>{q(x.code)?.name ?? x.code}</td><td>{x.value}</td><td className="muted">{x.specMin ?? "–"} to {x.specMax ?? "–"}</td><td><span className={`badge ${x.pass ? "b-green" : "b-red"}`}>{x.pass ? "yes" : "no"}</span></td></tr>)}</tbody>
          </table>
        </div>
      )}
      {run.resultNotes && <div className="small muted">Why this result: {(run.resultNotes as string[]).join("; ")}</div>}
      {run.overridden && <div className="small muted">Override reason: {run.overrideReason}</div>}
      {run.lossKg !== null && <div className="small muted">Loss {run.lossKg} kg</div>}
      {run.reasons.length > 0 && <div className="row small" style={{ marginTop: 6 }}>Reasons: {run.reasons.map((r: any) => <span key={r.code} className="badge b-amber">{r.label}</span>)}</div>}

      {run.status === "Planned" && can(role, "startRun") && <div style={{ marginTop: 8 }}><button disabled={busy} onClick={() => act(() => api(`/api/runs/${run.id}/start`, { method: "POST" }), "Run started.")}>Start run</button></div>}

      {["Planned", "Running"].includes(run.status) && can(role, "enterResults") && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <h3 style={{ marginTop: 0 }}>Enter results</h3>
          <div className="form-grid">
            {d.paramDefs.map((p: any) => (
              <div className="field" key={p.code}>
                <label htmlFor={`${run.id}-a-${p.code}`}>Actual {p.name} ({p.unit})</label>
                <input id={`${run.id}-a-${p.code}`} type="number" step="any" placeholder={String(run.params.find((x: any) => x.code === p.code)?.planned ?? "")} value={res.actuals[p.code] ?? ""} onChange={(e) => setRes({ ...res, actuals: { ...res.actuals, [p.code]: e.target.value } })} />
              </div>
            ))}
          </div>
          <div className="form-grid" style={{ marginTop: 8 }}>
            {d.specs.map((s: any) => (
              <div className="field" key={s.code}>
                <label htmlFor={`${run.id}-q-${s.code}`}>{s.name} (spec {s.spec_min ?? "–"} to {s.spec_max ?? "–"}){s.is_critical ? " · critical" : ""}</label>
                <input id={`${run.id}-q-${s.code}`} type="number" step="any" value={res.quality[s.code] ?? ""} onChange={(e) => setRes({ ...res, quality: { ...res.quality, [s.code]: e.target.value } })} />
              </div>
            ))}
            <div className="field"><label htmlFor={`${run.id}-loss`}>Loss (kg)</label><input id={`${run.id}-loss`} type="number" min="0" step="any" value={res.loss} onChange={(e) => setRes({ ...res, loss: e.target.value })} /></div>
          </div>
          <div className="field" style={{ marginTop: 8 }}><label htmlFor={`${run.id}-n`}>Notes</label><textarea id={`${run.id}-n`} value={res.notes} onChange={(e) => setRes({ ...res, notes: e.target.value })} /></div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)" }}><input type="checkbox" style={{ width: "auto" }} checked={res.aborted} onChange={(e) => setRes({ ...res, aborted: e.target.checked })} /> The run was aborted</label>
          <p className="small muted">The result (Pass, Marginal or Fail) is calculated from these values and the specs. You cannot type it in.</p>
          {err && <div className="msg err">{err}</div>}
          <button disabled={busy} onClick={submitResults}>Save results</button>
        </div>
      )}

      {run.status === "Results entered" && can(role, "reviewRun") && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <h3 style={{ marginTop: 0 }}>Review this run</h3>
          {run.result !== "Pass" && (
            <>
              <div className="small muted">Pick at least one reason (required for Marginal or Fail).</div>
              <div className="row" style={{ margin: "6px 0" }}>
                {d.reasonCodes.map((r: any) => (
                  <label key={r.code} style={{ display: "flex", gap: 5, alignItems: "center", color: "var(--ink)", fontSize: 13 }}>
                    <input type="checkbox" style={{ width: "auto" }} checked={rev.reasons.includes(r.code)}
                      onChange={(e) => setRev({ ...rev, reasons: e.target.checked ? [...rev.reasons, r.code] : rev.reasons.filter((x: string) => x !== r.code) })} />{r.label}
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="form-grid">
            <div className="field"><label htmlFor={`${run.id}-ns`}>Next step</label>
              <select id={`${run.id}-ns`} value={rev.nextStep} onChange={(e) => setRev({ ...rev, nextStep: e.target.value })}>
                <option value="TA" disabled={run.result !== "Pass"}>Send for Technical Acceptance</option><option value="Repeat">Repeat with changes</option><option value="Stop">Stop the launch</option>
              </select></div>
            <div className="field"><label htmlFor={`${run.id}-ov`}>Override the calculated result (rare)</label>
              <select id={`${run.id}-ov`} value={rev.override} onChange={(e) => setRev({ ...rev, override: e.target.value })}><option value="">No override</option><option>Pass</option><option>Marginal</option><option>Fail</option></select></div>
            {rev.override && <div className="field"><label htmlFor={`${run.id}-or`}>Reason for override (required)</label><input id={`${run.id}-or`} value={rev.overrideReason} onChange={(e) => setRev({ ...rev, overrideReason: e.target.value })} /></div>}
          </div>
          {err && <div className="msg err">{err}</div>}
          <div style={{ marginTop: 8 }}><button disabled={busy} onClick={submitReview}>Save review</button></div>
        </div>
      )}
    </div>
  );
}

function Compare({ d }: any) {
  return (
    <details>
      <summary className="small muted" style={{ cursor: "pointer" }}>Compare runs side by side</summary>
      <div className="tw">
        <table>
          <thead><tr><th>Parameter</th>{d.runs.map((r: any) => <th key={r.id}>Run {r.runNo}</th>)}</tr></thead>
          <tbody>
            {d.paramDefs.map((p: any) => <tr key={p.code}><td>{p.name} ({p.unit})</td>{d.runs.map((r: any) => <td key={r.id}>{r.params.find((x: any) => x.code === p.code)?.actual ?? r.params.find((x: any) => x.code === p.code)?.planned ?? "–"}</td>)}</tr>)}
            {d.specs.map((s: any) => <tr key={s.code}><td>{s.name}</td>{d.runs.map((r: any) => { const x = r.quality.find((y: any) => y.code === s.code); return <td key={r.id}>{x ? <span style={{ color: x.pass ? "inherit" : "var(--red)" }}>{x.value}</span> : "–"}</td>; })}</tr>)}
            <tr><td>Result</td>{d.runs.map((r: any) => <td key={r.id}>{r.result ?? "–"}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}

/* ---------------------------------------------------------------- import a report */
function ImportPanel({ d, id, aiOn, reload }: any) {
  const [busy, setBusy] = useState(false);
  const [ex, setEx] = useState<any>(null);
  const [msg, setMsg] = useState<Msg>(null);
  async function upload(f: File) {
    setBusy(true); setMsg(null); setEx(null);
    const form = new FormData(); form.append("file", f); form.append("launchId", id);
    const r = await api("/api/ai/extract", { form });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.error === "ai_unavailable" ? "AI is not configured on this server (no API key)." : r.message ?? "Failed" });
    setEx(r.data);
  }
  async function decide(ok: boolean) {
    setBusy(true);
    const r = await api(`/api/ai/extractions/${ex.extractionId}/${ok ? "approve" : "reject"}`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Failed" });
    setMsg({ kind: "ok", text: ok ? "Run created from the report. Review it below." : "Extraction rejected." });
    setEx(null); reload();
  }
  return (
    <details className="card">
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Import a trial report (PDF or text)</summary>
      <p className="small muted">Claude reads the report and proposes the values with quotes from the document. Nothing is saved until you approve it, and the usual rules still apply.</p>
      <input type="file" accept=".pdf,.txt,.csv,.md,application/pdf,text/plain" disabled={busy || !aiOn} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label="Trial report file" />
      {!aiOn && <p className="small muted">Needs an Anthropic API key on the server.</p>}
      {busy && <p className="muted">Working…</p>}
      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      {ex && (
        <div style={{ marginTop: 10 }}>
          {ex.problems.length > 0 && <div className="msg warn">Check before approving: {ex.problems.join("; ")}</div>}
          {ex.output ? (
            <div className="tw"><table><thead><tr><th>Field</th><th>Value</th><th>Quote from the document</th></tr></thead><tbody>
              {ex.output.parameters.map((p: any) => <tr key={p.code}><td>{p.code}</td><td>{p.actual}</td><td className="small muted">{p.source_quote ?? ""}</td></tr>)}
              {ex.output.quality.map((p: any) => <tr key={p.code}><td>{p.code}</td><td>{p.value}</td><td className="small muted">{p.source_quote ?? ""}</td></tr>)}
              {ex.output.loss_kg != null && <tr><td>loss_kg</td><td>{ex.output.loss_kg}</td><td /></tr>}
            </tbody></table></div>
          ) : <div className="msg err">Claude's answer could not be used.</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <button disabled={busy || !ex.output} onClick={() => decide(true)}>Approve and create the run</button>
            <button className="ghost" disabled={busy} onClick={() => decide(false)}>Reject</button>
          </div>
        </div>
      )}
    </details>
  );
}

function CancelPanel({ id, busy, act }: any) {
  const [reason, setReason] = useState("");
  return (
    <details className="card">
      <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Cancel this launch</summary>
      <div className="row" style={{ marginTop: 8 }}>
        <input aria-label="Reason for cancelling" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ maxWidth: 360 }} />
        <button className="danger" disabled={busy || !reason.trim()} onClick={() => act(() => api(`/api/launches/${id}/cancel`, { body: { reason } }), "Launch cancelled.")}>Cancel launch</button>
      </div>
    </details>
  );
}

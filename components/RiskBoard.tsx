"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import { RATING, ratingClass } from "./assetUi";
import { can, type Role } from "@/lib/permissions";

const lvl = (l: string) => (l === "High" ? "b-red" : l === "Medium" ? "b-amber" : "b-green");
const stClass: Record<string, string> = { New: "b-red", Acknowledged: "b-blue", Planned: "b-blue", Deferred: "b-amber", Done: "b-green", Dismissed: "b-gray" };
const today = () => new Date().toISOString().slice(0, 10);
type Msg = { kind: "ok" | "err"; text: string } | null;

export default function RiskBoard({ role, board }: { role: Role; board: any }) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<{ id: string; kind: "Planned" | "Deferred" | "Dismissed" } | null>(null);
  const [f, setF] = useState<any>({ stopId: "", reason: "", until: "" });
  const [w, setW] = useState<Record<string, string>>(Object.fromEntries(Object.entries(board.weights).map(([k, v]) => [k, String(v)])));
  const [wReason, setWReason] = useState("");
  const [bt, setBt] = useState<any>(null);
  const canAct = can(role, "ackAlerts"), canWeights = can(role, "riskWeights");

  async function call(path: string, body: unknown | undefined, ok: string, method?: string) {
    setBusy(true); setMsg(null);
    const r = await api(path, { body, method });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: "err", text: r.message ?? "Failed" }); return null; }
    setMsg({ kind: "ok", text: ok }); setPanel(null); router.refresh();
    return r.data;
  }
  const act = (id: string, to: string, extra: Record<string, unknown> = {}) => call(`/api/risk/alerts/${id}`, { to, ...extra }, `Alert ${to.toLowerCase()}.`);
  const open = board.alerts.filter((a: any) => ["New", "Acknowledged", "Planned", "Deferred"].includes(a.state));
  const recent = board.alerts.filter((a: any) => !["New", "Acknowledged", "Planned", "Deferred"].includes(a.state));

  return (
    <>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card kpi"><div className="l">High</div><div className="v" style={{ color: "var(--bad)" }}>{board.counts.High}</div><div className="d">score {board.thresholds.high} or more</div></div>
        <div className="card kpi"><div className="l">Medium</div><div className="v">{board.counts.Medium}</div><div className="d">score {board.thresholds.medium} to {board.thresholds.high - 0.1}</div></div>
        <div className="card kpi"><div className="l">Low</div><div className="v">{board.counts.Low}</div><div className="d">below {board.thresholds.medium}</div></div>
        <div className="card kpi"><div className="l">Open alerts</div><div className="v">{open.length}</div><div className="d">{board.lastRefresh ? `scored ${board.lastRefresh}` : "not scored yet"}</div></div>
      </div>
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Alerts</h2>
          {canAct && <button className="ghost" disabled={busy} onClick={() => call("/api/risk", {}, "Scores and alerts refreshed.")}>Refresh scores and alerts</button>}
        </div>
        <p className="small muted">An alert is raised when a seal scores High, or is projected to within 45 days. The system raises alerts; people acknowledge, plan, defer or dismiss them, with a reason. A seal rated damaged, or with a foreign body found in the last 30 days, cannot be dismissed.</p>
        <div className="tw"><table>
          <thead><tr><th>Position</th><th>Level</th><th>Reaches High</th><th>Suggested stop</th><th>State</th><th>Why</th>{canAct && <th></th>}</tr></thead>
          <tbody>
            {open.length === 0 && <tr><td colSpan={7} className="muted">No open alerts. Use Refresh to score the plant.</td></tr>}
            {open.map((a: any) => {
              const r = board.ranked.find((x: any) => x.positionId === a.position_id);
              const rec = r?.recommendedStop;
              const pn = panel && panel.id === a.id ? panel : null;
              return (
                <tr key={a.id}>
                  <td><Link href={`/assets/positions/${a.position_id}`}>{a.line_code} · {a.assembly} · {a.position_name}</Link><div className="small muted mono">{a.part_code}</div></td>
                  <td><span className={`badge ${lvl(a.level)}`}>{a.level}</span> <span className="small">{Number(a.score)}</span></td>
                  <td>{a.projected_high_on ? (a.projected_high_on <= today() ? "now" : a.projected_high_on) : "not within a year"}</td>
                  <td className="small">{a.state === "Planned" && a.stop_start ? <>Planned: {a.stop_start}{a.stop_end !== a.stop_start ? ` to ${a.stop_end}` : ""} ({a.stop_kind})</> : rec?.stop ? <>{rec.stop.start_on} ({rec.stop.kind}){!rec.before && <div className="muted">{rec.note}</div>}</> : <span className="muted">{rec?.note}</span>}</td>
                  <td><span className={`badge ${stClass[a.state]}`}>{a.state}</span>{a.state === "Deferred" && <div className="small muted">until {a.defer_until}<br />{a.state_reason}</div>}</td>
                  <td className="small" style={{ minWidth: 150 }}><details><summary>Why</summary><div style={{ minWidth: 280 }}>{a.summary}</div></details></td>
                  {canAct && <td style={{ whiteSpace: "nowrap" }}>
                    {a.state === "New" && <button className="small ghost" disabled={busy} onClick={() => act(a.id, "Acknowledged")}>Acknowledge</button>}{" "}
                    <button className="small ghost" disabled={busy} onClick={() => { setPanel({ id: a.id, kind: "Planned" }); setF({ stopId: rec?.stop?.id ?? "", reason: "", until: "" }); }}>Plan</button>{" "}
                    <button className="small ghost" disabled={busy} onClick={() => { setPanel({ id: a.id, kind: "Deferred" }); setF({ stopId: "", reason: "", until: "" }); }}>Defer</button>{" "}
                    <button className="small ghost" disabled={busy} onClick={() => { setPanel({ id: a.id, kind: "Dismissed" }); setF({ stopId: "", reason: "", until: "" }); }}>Dismiss</button>
                    {pn && (
                      <div className="preview" style={{ marginTop: 8, minWidth: 260, whiteSpace: "normal" }}>
                        {pn.kind === "Planned" && <div className="field"><label htmlFor={`s${a.id}`}>Planned stop for the seal change</label>
                          <select id={`s${a.id}`} value={f.stopId} onChange={(e) => setF({ ...f, stopId: e.target.value })}><option value="">Choose…</option>
                            {(board.stops[a.line_code] ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.start_on}{s.end_on !== s.start_on ? ` to ${s.end_on}` : ""} · {s.kind}</option>)}</select></div>}
                        {pn.kind === "Deferred" && <div className="field"><label htmlFor={`u${a.id}`}>Look again on</label><input id={`u${a.id}`} type="date" min={today()} value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></div>}
                        {pn.kind !== "Planned" && <div className="field"><label htmlFor={`r${a.id}`}>Reason</label><input id={`r${a.id}`} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>}
                        <button className="small" style={{ marginTop: 8 }} disabled={busy} onClick={() => act(a.id, pn.kind, { stopId: f.stopId || undefined, reason: f.reason || undefined, deferUntil: f.until || undefined })}>Confirm</button>{" "}
                        <button className="small ghost" onClick={() => setPanel(null)}>Cancel</button>
                      </div>)}
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {recent.length > 0 && <details style={{ marginTop: 10 }}><summary className="small">Closed in the last 30 days ({recent.length})</summary>
          <div className="tw"><table><tbody>{recent.map((a: any) => <tr key={a.id}><td>{a.line_code} · {a.assembly} · {a.position_name}</td><td><span className={`badge ${stClass[a.state]}`}>{a.state}</span></td><td className="small">{a.state_reason}</td></tr>)}</tbody></table></div></details>}
      </div>

      <div className="card">
        <h2>All seals, highest score first</h2>
        <div className="tw"><table>
          <thead><tr><th>Position</th><th>Score</th><th>Biggest contributors</th><th>Last inspection</th><th>Reaches High</th></tr></thead>
          <tbody>
            {board.ranked.slice(0, 25).map((r: any) => (
              <tr key={r.positionId}>
                <td><Link href={`/assets/positions/${r.positionId}`}>{r.lineCode} · {r.assembly} · {r.positionName}</Link></td>
                <td><span className={`badge ${lvl(r.result.level)}`}>{r.result.level}</span> <strong>{r.result.score}</strong></td>
                <td className="small">{[...r.result.factors].filter((x: any) => x.points > 0).sort((a: any, b: any) => b.points - a.points).slice(0, 3).map((x: any) => `${x.label} (${x.points})`).join(", ")}</td>
                <td>{r.lastRating ? <span className={`badge ${ratingClass(r.lastRating)}`}>{RATING[r.lastRating]}</span> : <span className="muted">never</span>}</td>
                <td>{r.projectedDays === 0 ? "now" : r.projectedHighOn ?? "not within a year"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="small muted" style={{ marginBottom: 0 }}>Showing the top 25 of {board.ranked.length}. Open a position for the full breakdown.</p>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>How the score is built</h2>
          <p className="small muted">Each factor is a value from 0 to 1. The score is the weighted share, times a criticality multiplier (0.7 + 0.1 × criticality), capped at 100, and then expert floors apply (for example, rated damaged means at least 75). A factor with no data is left out and listed as missing, never guessed. Engineers set each weight from 0 (ignore) to 5 (very important).</p>
          <div className="tw"><table>
            <thead><tr><th>Factor</th><th style={{ width: 90 }}>Weight</th></tr></thead>
            <tbody>{Object.keys(board.weights).map((k) => (
              <tr key={k}><td>{board.factorLabels[k]}</td>
                <td><input aria-label={`Weight for ${board.factorLabels[k]}`} type="number" min={0} max={5} step={1} disabled={!canWeights} value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} /></td></tr>))}</tbody>
          </table></div>
          {canWeights ? <>
            <div className="field" style={{ marginTop: 10 }}><label htmlFor="wr">Why are the weights changing?</label><input id="wr" value={wReason} onChange={(e) => setWReason(e.target.value)} /></div>
            <button style={{ marginTop: 10 }} disabled={busy} onClick={() => call("/api/risk/weights", { weights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Number(v)])), reason: wReason }, "Weights saved. Refresh the scores to apply them to alerts.")}>Save weights</button>
          </> : <p className="small muted">Plant admins, process engineers and category owners change the weights.</p>}
        </div>
        <div className="card">
          <h2>Would it have warned in time?</h2>
          <p className="small muted">Re-scores every seal that has come out, as the data stood 30 days earlier, and compares with a simple rule (flag any seal past 85% of planned life).</p>
          <button className="ghost" disabled={busy} onClick={async () => { setBusy(true); const r = await api("/api/risk/backtest"); setBusy(false); if (r.ok) setBt(r.data); else setMsg({ kind: "err", text: r.message ?? "Failed" }); }}>Run the backtest</button>
          {bt && (
            <div style={{ marginTop: 12 }}>
              <div className="tw"><table>
                <thead><tr><th></th><th>Early failures flagged 30 days ahead ({bt.failures})</th><th>Scheduled removals flagged, agrees with the plan ({bt.others})</th></tr></thead>
                <tbody>
                  <tr><td>Score High (70+)</td><td>{bt.engine.highOfFailures}</td><td>{bt.engine.highOfOthers}</td></tr>
                  <tr><td>Score Medium or High (40+)</td><td>{bt.engine.mediumUpOfFailures} ({bt.pct.failuresCaughtMedium ?? "–"}%)</td><td>{bt.engine.mediumUpOfOthers} ({bt.pct.falseAlarmsMedium ?? "–"}%)</td></tr>
                  <tr><td>Age-only rule (85% of life)</td><td>{bt.ageOnly.flaggedFailures} ({bt.pct.ageCaught ?? "–"}%)</td><td>{bt.ageOnly.flaggedOthers} ({bt.pct.ageFalse ?? "–"}%)</td></tr>
                </tbody>
              </table></div>
              <div className="msg warn">{bt.note}</div>
            </div>)}
        </div>
      </div>
    </>
  );
}

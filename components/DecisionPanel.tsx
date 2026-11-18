"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

type Sc = { label: string; title: string; needsCM: boolean };
export default function DecisionPanel({ code, scenarios, role, canDecide, last }: { code: string; scenarios: Sc[]; role: string; canDecide: boolean; last: { action: string; label: string; by: string; reason: string | null; at: string } | null }) {
  const router = useRouter();
  const [pick, setPick] = useState(scenarios.find((s) => s.title.toLowerCase().includes("promo"))?.label ?? scenarios[0]?.label ?? "A");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sc = scenarios.find((s) => s.label === pick);

  async function send(action: "Accepted" | "Rejected" | "Deferred") {
    setBusy(true); setMsg(null);
    const r = await api(`/api/moves/${code}/decision`, { body: { label: pick, action, reason: reason.trim() || undefined, deferUntil: action === "Deferred" ? until : undefined } });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message ?? "Failed" });
    setMsg({ ok: true, text: `${action}: scenario ${pick}. Recorded with your name. The radar changes nothing; the response is carried out by people.` });
    router.refresh();
  }
  const needCM = !!sc?.needsCM && role !== "category_manager";
  return (
    <section className="card" style={{ borderColor: "var(--link)" }}>
      <h2>Your decision</h2>
      {last && <div className="msg info">Latest decision: <strong>{last.action}</strong> scenario {last.label} by {last.by}{last.reason ? `. Reason: ${last.reason}` : ""}. A new decision replaces it for the radar; the history is kept.</div>}
      {!canDecide ? <p className="muted">Your role ({role.replace("_", " ")}) can read this move but not decide. Sales leads and category managers decide.</p> : <>
        <p className="small muted">Pick one scenario, then accept, defer or reject. A defer or reject needs a reason. The decision is recorded with your name and cannot be edited.</p>
        <div className="row" role="group" aria-label="Scenario" style={{ marginBottom: 12 }}>
          {scenarios.map((s) => <button key={s.label} className={pick === s.label ? "" : "ghost"} onClick={() => setPick(s.label)} aria-pressed={pick === s.label}>{s.label}. {s.title}</button>)}
        </div>
        <div className="form-grid" style={{ maxWidth: 640 }}>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="why">Reason (needed to defer or reject)</label><input id="why" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: the gap is temporary, hold for two weeks" /></div>
          <div className="field"><label htmlFor="until">Defer until</label><input id="until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
        </div>
        {needCM && <div className="msg warn">Scenario {pick} (price match) can only be accepted by a category manager. You can still defer or reject it.</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={busy || needCM} onClick={() => send("Accepted")}>Accept scenario {pick}</button>
          <button className="ghost" disabled={busy || reason.trim().length < 5} onClick={() => send("Deferred")}>Defer</button>
          <button className="ghost" disabled={busy || reason.trim().length < 5} onClick={() => send("Rejected")} style={{ color: "var(--bad)", borderColor: "var(--bad)" }}>Reject</button>
        </div>
      </>}
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
    </section>
  );
}

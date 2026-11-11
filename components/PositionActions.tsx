"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import { RATING } from "./assetUi";
import { can, type Role } from "@/lib/permissions";

const today = () => new Date().toISOString().slice(0, 10);
type Msg = { kind: "ok" | "err"; text: string } | null;

export default function PositionActions({ role, positionId, hasSeal, partTypes, defaultTypeId, nextCode }: {
  role: Role; positionId: string; hasSeal: boolean; partTypes: { id: string; code: string; name: string; nominal_life_days: number }[]; defaultTypeId?: string; nextCode: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"replace" | "inspect" | "incident" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<any>({ partCode: nextCode, partTypeId: defaultTypeId ?? partTypes[0]?.id ?? "", lot: "", date: today(), reason: "planned_replacement", note: "", rating: "2", finding: "", kind: "foreign_body", severity: "Minor", description: "" });
  const set = (k: string, v: string) => setF((x: any) => ({ ...x, [k]: v }));

  async function send(body: Record<string, unknown>, ok: string) {
    setBusy(true); setMsg(null);
    const r = await api(`/api/assets/positions/${positionId}`, { body });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Failed" });
    setMsg({ kind: "ok", text: ok }); setOpen(null); router.refresh();
  }
  const canWork = can(role, "recordSealWork"), canInspect = can(role, "recordInspection"), canIncident = can(role, "recordIncident");
  if (!canWork && !canInspect && !canIncident) return <div className="msg info">Your role can read this position. Maintenance records seal changes and inspections.</div>;

  return (
    <div className="card">
      <h2>Record</h2>
      <div className="row">
        {canWork && <button className={open === "replace" ? "" : "ghost"} onClick={() => setOpen(open === "replace" ? null : "replace")}>{hasSeal ? "Replace seal" : "Fit a seal"}</button>}
        {canInspect && hasSeal && <button className={open === "inspect" ? "" : "ghost"} onClick={() => setOpen(open === "inspect" ? null : "inspect")}>Record inspection</button>}
        {canIncident && <button className={open === "incident" ? "" : "ghost"} onClick={() => setOpen(open === "incident" ? null : "incident")}>Report incident</button>}
      </div>
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
      {open === "replace" && (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor="pc">New part code</label><input id="pc" value={f.partCode} onChange={(e) => set("partCode", e.target.value)} /></div>
          <div className="field"><label htmlFor="pt">Part type</label><select id="pt" value={f.partTypeId} onChange={(e) => set("partTypeId", e.target.value)}>{partTypes.map((t) => <option key={t.id} value={t.id}>{t.code}, {t.name} ({t.nominal_life_days} d)</option>)}</select></div>
          <div className="field"><label htmlFor="lot">Lot (optional)</label><input id="lot" value={f.lot} onChange={(e) => set("lot", e.target.value)} /></div>
          <div className="field"><label htmlFor="d1">Date fitted</label><input id="d1" type="date" max={today()} value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
          {hasSeal && <div className="field"><label htmlFor="rr">Why the current seal comes out</label>
            <select id="rr" value={f.reason} onChange={(e) => set("reason", e.target.value)}>{["planned_replacement", "failure", "inspection_finding", "upgrade", "other"].map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></div>}
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="n1">Note (optional)</label><input id="n1" value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
          <div><button disabled={busy || !f.partCode || !f.partTypeId} onClick={() => send({ action: "replace", partCode: f.partCode.trim(), partTypeId: f.partTypeId, lot: f.lot || undefined, installedOn: f.date, removalReason: hasSeal ? f.reason : undefined, note: f.note || undefined }, "Seal recorded.")}>{hasSeal ? "Replace" : "Fit"}</button></div>
        </div>
      )}
      {open === "inspect" && (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor="d2">Inspection date</label><input id="d2" type="date" max={today()} value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
          <div className="field"><label htmlFor="rt">Condition</label><select id="rt" value={f.rating} onChange={(e) => set("rating", e.target.value)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} · {RATING[n]}</option>)}</select></div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="fn">What you see (optional)</label><input id="fn" value={f.finding} onChange={(e) => set("finding", e.target.value)} /></div>
          <div><button disabled={busy} onClick={() => send({ action: "inspect", inspectedOn: f.date, rating: Number(f.rating), finding: f.finding || undefined }, "Inspection recorded.")}>Save inspection</button></div>
        </div>
      )}
      {open === "incident" && (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor="d3">Date</label><input id="d3" type="date" max={today()} value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
          <div className="field"><label htmlFor="ik">Kind</label><select id="ik" value={f.kind} onChange={(e) => set("kind", e.target.value)}>{["foreign_body", "leak", "seal_failure", "contamination_risk"].map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></div>
          <div className="field"><label htmlFor="sv">Severity</label><select id="sv" value={f.severity} onChange={(e) => set("severity", e.target.value)}>{["Minor", "Major", "Critical"].map((r) => <option key={r}>{r}</option>)}</select></div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="ds">What happened</label><textarea id="ds" value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div><button disabled={busy} onClick={() => send({ action: "incident", occurredOn: f.date, kind: f.kind, severity: f.severity, description: f.description || undefined }, "Incident recorded.")}>Save incident</button></div>
        </div>
      )}
    </div>
  );
}

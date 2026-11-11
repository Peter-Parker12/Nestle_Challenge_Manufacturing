"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import { can, type Role } from "@/lib/permissions";

const today = () => new Date().toISOString().slice(0, 10);
const kindClass: Record<string, string> = { CIP: "b-blue", changeover: "b-gray", maintenance: "b-amber", shutdown: "b-red" };
const stClass: Record<string, string> = { Planned: "b-blue", Done: "b-green", Cancelled: "b-gray" };

export default function StopsManager({ role, lines, stops }: { role: Role; lines: { id: string; code: string; name: string }[]; stops: any[] }) {
  const router = useRouter();
  const [f, setF] = useState({ lineId: lines[0]?.id ?? "", startOn: today(), endOn: today(), kind: "maintenance", note: "" });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can(role, "manageStops");

  async function send(body: Record<string, unknown>, ok: string) {
    setBusy(true); setMsg(null);
    const r = await api("/api/assets/stops", { body });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Failed" });
    setMsg({ kind: "ok", text: ok }); router.refresh();
  }
  return (
    <>
      {canEdit && (
        <div className="card">
          <h2>Add a planned stop</h2>
          <div className="form-grid">
            <div className="field"><label htmlFor="ln">Line</label><select id="ln" value={f.lineId} onChange={(e) => setF({ ...f, lineId: e.target.value })}>{lines.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select></div>
            <div className="field"><label htmlFor="k">Kind</label><select id="k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{["CIP", "changeover", "maintenance", "shutdown"].map((k) => <option key={k}>{k}</option>)}</select></div>
            <div className="field"><label htmlFor="s">From</label><input id="s" type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value, endOn: e.target.value > f.endOn ? e.target.value : f.endOn })} /></div>
            <div className="field"><label htmlFor="e">To</label><input id="e" type="date" min={f.startOn} value={f.endOn} onChange={(e) => setF({ ...f, endOn: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="n">Note</label><input id="n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
            <div><button disabled={busy} onClick={() => send({ action: "create", ...f, note: f.note || undefined }, "Stop added.")}>Add stop</button></div>
          </div>
          {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
        </div>
      )}
      <div className="card">
        <h2>Calendar</h2>
        <div className="tw"><table>
          <thead><tr><th>Line</th><th>From</th><th>To</th><th>Kind</th><th>Status</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {stops.length === 0 && <tr><td colSpan={7} className="muted">No stops.</td></tr>}
            {stops.map((s) => (
              <tr key={s.id}>
                <td>{s.line_code}</td><td>{s.start_on}</td><td>{s.end_on}</td>
                <td><span className={`badge ${kindClass[s.kind]}`}>{s.kind}</span></td>
                <td><span className={`badge ${stClass[s.status]}`}>{s.status}</span></td>
                <td>{s.note}</td>
                <td style={{ whiteSpace: "nowrap" }}>{canEdit && s.status === "Planned" && <>
                  <button className="ghost small" disabled={busy} onClick={() => send({ action: "status", id: s.id, status: "Done" }, "Marked done.")}>Done</button>{" "}
                  <button className="ghost small" disabled={busy} onClick={() => send({ action: "status", id: s.id, status: "Cancelled" }, "Cancelled.")}>Cancel</button></>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

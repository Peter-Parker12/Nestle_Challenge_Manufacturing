"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import { can, type Role } from "@/lib/permissions";

export default function SettingsPanel({ role, settings }: { role: Role; settings: any[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [why, setWhy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canApply = can(role, "applyCorrection");

  async function save(id: string) {
    setBusy(true); setMsg(null);
    const r = await api("/api/line-health/corrections", { body: { settingId: id, toValue: Number(val), reason: why } });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Failed" });
    setMsg({ kind: "ok", text: "Recorded." }); setOpen(null); setVal(""); setWhy(""); router.refresh();
  }
  return (
    <>
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
      <div className="tw"><table>
        <thead><tr><th>Setting</th><th>Now</th><th>Target</th><th>Approved range</th><th></th></tr></thead>
        <tbody>
          {settings.map((s) => {
            const cur = Number(s.current_value), out = cur < Number(s.min_value) || cur > Number(s.max_value);
            return (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{cur} {s.unit} {out && <span className="badge b-red">outside range</span>}</td>
                <td>{Number(s.target)} {s.unit}</td>
                <td>{Number(s.min_value)} to {Number(s.max_value)} {s.unit}</td>
                <td>{canApply && (open === s.id ? (
                  <div className="preview" style={{ minWidth: 240 }}>
                    <div className="field"><label htmlFor={`v${s.id}`}>New value ({s.unit}), within {Number(s.min_value)} to {Number(s.max_value)}</label><input id={`v${s.id}`} type="number" step="any" value={val} onChange={(e) => setVal(e.target.value)} /></div>
                    <div className="field" style={{ marginTop: 6 }}><label htmlFor={`w${s.id}`}>Why</label><input id={`w${s.id}`} value={why} onChange={(e) => setWhy(e.target.value)} /></div>
                    <button className="small" style={{ marginTop: 8 }} disabled={busy || val === "" || why.trim().length < 5} onClick={() => save(s.id)}>Record the change</button>{" "}
                    <button className="small ghost" onClick={() => setOpen(null)}>Cancel</button>
                  </div>
                ) : <button className="small ghost" onClick={() => { setOpen(s.id); setVal(String(Number(s.target))); }}>Record a change</button>)}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <p className="small muted">This system never writes to the machine. Change the setting on the machine first, then record it here. A value outside the approved range is refused.</p>
    </>
  );
}

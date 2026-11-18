"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

type S = { key: string; value: string; min_value: string; max_value: string; unit: string; label: string; help: string; updated_by_name: string | null };
export default function SettingsForm({ settings, canEdit }: { settings: S[]; canEdit: boolean }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(settings.map((s) => [s.key, String(Number(s.value))])));
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = settings.filter((s) => Number(vals[s.key]) !== Number(s.value));
  async function save() {
    setBusy(true); setMsg(null);
    for (const s of changed) {
      const r = await api("/api/settings", { body: { key: s.key, value: Number(vals[s.key]), reason } });
      if (!r.ok) { setBusy(false); return setMsg({ ok: false, text: `${s.label}: ${r.message}` }); }
    }
    setBusy(false); setReason(""); setMsg({ ok: true, text: "Saved. The next refresh uses the new values." }); router.refresh();
  }
  return (
    <div>
      <div className="tw"><table>
        <thead><tr><th>Setting</th><th>Value</th><th>Allowed</th><th>What it does</th></tr></thead>
        <tbody>{settings.map((s) => (
          <tr key={s.key}>
            <td><label htmlFor={s.key} style={{ color: "var(--ink)", fontSize: 13.5 }}>{s.label}</label><span className="small muted">{s.unit}{s.updated_by_name ? ` · changed by ${s.updated_by_name.split(" (")[0]}` : ""}</span></td>
            <td style={{ width: 150 }}><input id={s.key} inputMode="decimal" value={vals[s.key]} disabled={!canEdit} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} /></td>
            <td className="small muted">{Number(s.min_value)} to {Number(s.max_value)}</td>
            <td className="small muted">{s.help}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {canEdit ? (
        <div className="row" style={{ marginTop: 12, alignItems: "end" }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}><label htmlFor="reason">Why are you changing {changed.length || "a"} setting{changed.length === 1 ? "" : "s"}?</label><input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: Finance confirmed a 30% gross margin" /></div>
          <button disabled={busy || changed.length === 0 || reason.trim().length < 5} onClick={save}>Save changes</button>
        </div>
      ) : <p className="small muted">Category managers and admins can change settings. Every change is audited with a reason.</p>}
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role="alert">{msg.text}</div>}
    </div>
  );
}

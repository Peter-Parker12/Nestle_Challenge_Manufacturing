"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

export default function GuideForm() {
  const router = useRouter();
  const [f, setF] = useState({ code: "", title: "", alarms: "", keywords: "", steps: "", source: "" });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const split = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  async function save() {
    setBusy(true); setMsg(null);
    const r = await api("/api/line-health/guides", { body: { code: f.code.trim(), title: f.title, alarmCodes: split(f.alarms), keywords: split(f.keywords), steps: f.steps.split("\n").map((x) => x.trim()).filter(Boolean), source: f.source || undefined } });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Failed" });
    setMsg({ kind: "ok", text: "Guide added." }); setF({ code: "", title: "", alarms: "", keywords: "", steps: "", source: "" }); router.refresh();
  }
  return (
    <details className="card"><summary><strong>Add a guide</strong></summary>
      <p className="small muted">Write the steps as the site SOP says, one per line, including the lockout and safety step. The assistant may only quote these steps; it cannot add its own.</p>
      <div className="form-grid">
        <div className="field"><label htmlFor="gc">Code</label><input id="gc" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
        <div className="field"><label htmlFor="gt">Title</label><input id="gt" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="field"><label htmlFor="ga">Alarm codes (comma separated)</label><input id="ga" value={f.alarms} onChange={(e) => setF({ ...f, alarms: e.target.value })} /></div>
        <div className="field"><label htmlFor="gk">Keywords (comma separated)</label><input id="gk" value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="gs">Steps, one per line</label><textarea id="gs" value={f.steps} onChange={(e) => setF({ ...f, steps: e.target.value })} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="go">Source (SOP number)</label><input id="go" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></div>
        <div><button disabled={busy || !f.code || !f.title || !f.steps.trim()} onClick={save}>Add guide</button></div>
      </div>
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
    </details>
  );
}

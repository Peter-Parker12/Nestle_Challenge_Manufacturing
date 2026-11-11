"use client";
import { useState } from "react";
import { api } from "./api";
import { can, type Role } from "@/lib/permissions";

export default function AssetImport({ role }: { role: Role }) {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = can(role, "importAssets");

  async function run(commit: boolean) {
    if (!file) return;
    setBusy(true); setMsg(null); if (!commit) { setCheck(null); setDone(null); }
    const form = new FormData(); form.append("file", file); if (commit) form.append("commit", "true");
    const r = await api("/api/assets/import", { form });
    setBusy(false);
    if (!r.ok) return setMsg(r.message ?? "Failed");
    if (commit) { setDone(r.data.committed); setCheck(null); } else setCheck(r.data.check);
  }
  if (!allowed) return <div className="msg info">Only plant admins and maintenance import seal history.</div>;
  return (
    <>
      <div className="card">
        <h2>1. Choose the file</h2>
        <p className="small muted">One row per seal installation, oldest first or in any order. A seal still fitted has no removed date. <a href="/api/assets/import">Download the template</a> or <a href="/api/assets/import?export=1">export what is loaded now</a> (the export loads back in unchanged on a clean database).</p>
        <div className="row">
          <input aria-label="CSV file" type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setCheck(null); setDone(null); }} style={{ maxWidth: 360 }} />
          <button disabled={!file || busy} onClick={() => run(false)}>Check the file</button>
        </div>
        {msg && <div className="msg err" role="alert">{msg}</div>}
      </div>
      {check && (
        <div className="card">
          <h2>2. Result of the check</h2>
          <p>{check.summary.rows} rows · {check.summary.equipment} equipment · {check.summary.positions} positions · {check.summary.parts} seals · {check.summary.openSeals} currently fitted</p>
          {check.warnings.map((w: string) => <div key={w} className="msg warn">{w}</div>)}
          {check.ok ? <div className="msg ok">No problems found. Nothing has been saved yet.</div> : (
            <><div className="msg err">{check.errors.length} problem(s). Fix the file and check again.</div>
              <div className="tw"><table><thead><tr><th>Row</th><th>Problem</th></tr></thead><tbody>{check.errors.map((e: any, i: number) => <tr key={i}><td>{e.row}</td><td>{e.message}</td></tr>)}</tbody></table></div></>
          )}
          <button disabled={!check.ok || busy} onClick={() => run(true)} style={{ marginTop: 12 }}>3. Load into the plant</button>
        </div>
      )}
      {done && <div className="msg ok" role="status">Loaded {done.rows} rows: {done.equipment} equipment, {done.positions} positions, {done.parts} seals.</div>}
    </>
  );
}

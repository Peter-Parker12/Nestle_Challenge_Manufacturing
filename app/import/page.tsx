"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, badge } from "@/components/api";
import { can, type Role } from "@/lib/permissions";

export default function ImportPage() {
  const [role, setRole] = useState<Role | undefined>();
  const [cats, setCats] = useState<{ id: string; name: string; code: string }[]>([]);
  const [catId, setCatId] = useState("");
  const [loads, setLoads] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [assume, setAssume] = useState(true);
  const [res, setRes] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [skip, setSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await api("/api/import");
    if (r.ok) { setLoads(r.data.loads); setCats(r.data.categories); setCatId((c) => c || r.data.categories.find((x: any) => x.code === "UHT_DRINK")?.id || r.data.categories[0]?.id || ""); }
  }, []);
  useEffect(() => { refresh(); api("/api/session").then((r) => r.ok && setRole(r.data.user.role)); }, [refresh]);

  const allowed = can(role, "importHistory");

  async function check() {
    if (!file) return;
    setBusy(true); setMsg(null); setRes(null); setDone(null);
    const form = new FormData();
    form.append("file", file); form.append("categoryId", catId); form.append("assumeAccepted", String(assume));
    const r = await api("/api/import/validate", { form });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Could not read the file" });
    setRes(r.data); setSkip(false); refresh();
  }
  async function commit() {
    setBusy(true); setMsg(null);
    const r = await api(`/api/import/${res.loadId}/commit`, { body: { skipInvalid: skip } });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Import failed" });
    setDone(r.data); setRes(null); setFile(null); refresh();
  }

  const hasErrors = res && res.errors.length > 0;
  const canCommit = res && res.validLaunches > 0 && (!hasErrors || skip);

  return (
    <>
      <h1>Import history</h1>
      <p className="sub">
        Load previous launches and trial runs as the starting database. The recommendations learn from them. Check the file first: nothing is saved until you confirm, and every problem is reported by row.
      </p>

      {!allowed && role && <div className="msg warn">Your role cannot import data. Switch to the plant admin, category owner or process engineer.</div>}

      <div className="card">
        <h2>1. Get the template</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          One row per trial run. Rows with the same <span className="mono">launch_ref</span> form one launch. The columns are built from the category's attributes, process parameters and quality tests, so each category has its own template.
        </p>
        <div className="row">
          <div className="field" style={{ minWidth: 260 }}>
            <label htmlFor="ic">Category</label>
            <select id="ic" value={catId} onChange={(e) => { setCatId(e.target.value); setRes(null); }}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </div>
          <a className="btn ghost" style={{ alignSelf: "flex-end" }} href={`/api/import/template?categoryId=${catId}`}>Download template (CSV)</a>
          {allowed && <a className="btn ghost" style={{ alignSelf: "flex-end" }} href={`/api/import/export?categoryId=${catId}`}>Export current history (CSV)</a>}
        </div>
        <details style={{ marginTop: 10 }}>
          <summary className="small" style={{ cursor: "pointer" }}>How to fill it in</summary>
          <ul className="small" style={{ paddingLeft: 20 }}>
            <li><b>launch_ref, product_name, line, run_no</b> are required. Run numbers go 1, 2, 3 within a launch. <span className="mono">launch_ref</span> becomes the product code and must not exist yet, so a file cannot be imported twice.</li>
            <li><b>attr_…</b> columns: product attributes, filled on the first row of each launch. <b>param_…</b>: the settings actually used in that run. <b>q_…</b>: quality results. <b>spec_…_min / _max</b>: quality targets, first row of each launch.</li>
            <li>If a run has quality results and specs, the result (Pass, Marginal, Fail) is <b>calculated</b>. Otherwise fill the <b>result</b> column.</li>
            <li><b>reason_codes</b>: separated by semicolons, required for a failed or marginal run that is followed by another run.</li>
            <li><b>ta_decision</b> on the last run: Accepted, Accepted with conditions or Rejected. Dates are YYYY-MM-DD.</li>
            <li>Using Excel? Choose Save As, CSV (UTF-8). Empty cells are fine for anything unknown.</li>
          </ul>
        </details>
      </div>

      <div className="card">
        <h2>2. Check your file</h2>
        <div className="row">
          <input type="file" accept=".csv,text/csv" aria-label="History CSV file" style={{ maxWidth: 380 }} disabled={!allowed || busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); setDone(null); }} />
          <button disabled={!file || !allowed || busy} onClick={check}>{busy && !res ? "Checking…" : "Check the file"}</button>
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", marginTop: 10 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={assume} onChange={(e) => { setAssume(e.target.checked); setRes(null); }} />
          If a launch's last run passed and no technical acceptance is given, treat it as Accepted
        </label>
        <p className="small muted" style={{ marginBottom: 0 }}>Only launches that were accepted are used as evidence for recommendations. Failed or cancelled launches are kept for the history and the rework statistics.</p>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      </div>

      {res && (
        <div className="card">
          <h2>3. Review and import</h2>
          <div className="grid g4">
            <div className="kpi"><div className="l">Rows read</div><div className="v">{res.rows}</div></div>
            <div className="kpi"><div className="l">Launches found</div><div className="v">{res.launches}</div><div className="d">{res.runs} runs</div></div>
            <div className="kpi"><div className="l">Ready to import</div><div className="v" style={{ color: "var(--green)" }}>{res.validLaunches}</div><div className="d">{res.accepted} accepted</div></div>
            <div className="kpi"><div className="l">With errors</div><div className="v" style={{ color: res.invalidLaunches ? "var(--red)" : undefined }}>{res.invalidLaunches}</div><div className="d">{res.errors.length} problems</div></div>
          </div>

          {hasErrors && (
            <>
              <h3>Problems to fix</h3>
              <div className="tw" style={{ maxHeight: 320, overflowY: "auto" }}>
                <table>
                  <thead><tr><th>Row</th><th>Launch</th><th>Column</th><th>Problem</th></tr></thead>
                  <tbody>{res.errors.slice(0, 200).map((e: any, i: number) => (
                    <tr key={i}><td>{e.row ?? "–"}</td><td className="mono">{e.launch ?? "–"}</td><td className="mono">{e.field ?? "–"}</td><td>{e.message}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              {res.errors.length > 200 && <p className="small muted">Showing the first 200 of {res.errors.length}.</p>}
              <p className="small muted">Row numbers match the rows in your file, with the header as row 1. Fix the file and check it again, or import only the launches without errors.</p>
            </>
          )}
          {res.warnings.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary className="small" style={{ cursor: "pointer", color: "var(--amber)" }}>{res.warnings.length} warning(s): these do not block the import</summary>
              <div className="tw" style={{ maxHeight: 240, overflowY: "auto" }}>
                <table><tbody>{res.warnings.slice(0, 100).map((e: any, i: number) => <tr key={i}><td>{e.row ?? "–"}</td><td className="mono">{e.launch ?? ""}</td><td>{e.message}</td></tr>)}</tbody></table>
              </div>
            </details>
          )}

          <h3>Preview</h3>
          <div className="tw">
            <table>
              <thead><tr><th>Launch</th><th>Product</th><th>Line</th><th>Runs</th><th>Results</th><th>Outcome</th><th /></tr></thead>
              <tbody>{res.preview.map((p: any) => (
                <tr key={p.ref}><td className="mono">{p.ref}</td><td>{p.product}</td><td>{p.line}</td><td>{p.runs}</td>
                  <td>{p.results.map((r: string, i: number) => <span key={i} className={`badge ${badge(r)}`} style={{ marginRight: 4 }}>{r}</span>)}</td>
                  <td>{p.outcome ?? "–"}</td><td>{p.valid ? <span className="badge b-green">ok</span> : <span className="badge b-red">errors</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {res.launches > res.preview.length && <p className="small muted">Showing the first {res.preview.length} of {res.launches} launches.</p>}

          {hasErrors && res.validLaunches > 0 && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink)", marginTop: 10 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={skip} onChange={(e) => setSkip(e.target.checked)} />
              Import the {res.validLaunches} launches without errors and skip the {res.invalidLaunches} with errors
            </label>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button disabled={!canCommit || busy} onClick={commit}>{busy ? "Importing…" : `Import ${hasErrors && skip ? res.validLaunches : res.launches} launches`}</button>
            {hasErrors && !skip && <span className="small muted">Fix the errors, or choose to skip the launches that have them.</span>}
          </div>
        </div>
      )}

      {done && (
        <div className="msg ok" role="status">
          <b>{done.imported} launches imported.</b>{done.skipped ? ` ${done.skipped} skipped.` : ""} They are now part of the history, and the next recommendation will use the accepted ones.{" "}
          <Link href="/launches">See the launches</Link>
          {done.failed.length > 0 && <div>These could not be saved: {done.failed.map((f: any) => `${f.ref} (${f.message})`).join("; ")}</div>}
          {done.skippedWithErrors.length > 0 && <div>Skipped because of errors: {done.skippedWithErrors.join(", ")}</div>}
        </div>
      )}

      <div className="card">
        <h2>Previous imports</h2>
        <div className="tw"><table>
          <thead><tr><th>When</th><th>File</th><th>By</th><th>Status</th><th>Rows</th><th>Imported</th><th>With errors</th></tr></thead>
          <tbody>
            {loads.length === 0 && <tr><td colSpan={7} className="muted">No files checked yet.</td></tr>}
            {loads.map((l) => (
              <tr key={l.id}><td className="small mono">{new Date(l.loaded_at).toISOString().replace("T", " ").slice(0, 16)}</td>
                <td>{(() => { try { return JSON.parse(l.source_ref).filename; } catch { return "–"; } })()}</td><td>{l.loaded_by ?? "–"}</td>
                <td><span className={`badge ${l.status === "Imported" ? "b-green" : l.status === "Has errors" ? "b-red" : "b-gray"}`}>{l.status}</span></td>
                <td>{l.row_count}</td><td>{l.rows_imported}</td><td>{l.rows_with_errors}</td></tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

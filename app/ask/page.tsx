"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/api";

const EXAMPLES = [
  "Which launches with viscosity above 35 needed rework, and why?",
  "What are the most common reasons for rework in this category?",
  "Compare the accepted homogenisation pressure for the three highest-fat launches.",
];

export default function Ask() {
  const [catId, setCatId] = useState("");
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ids, setIds] = useState<Record<string, string>>({});

  useEffect(() => {
    api("/api/launches").then((r) => r.ok && setCatId(r.data.categories.find((c: any) => c.code === "UHT_DRINK")?.id ?? r.data.categories[0]?.id));
    api("/api/launches").then((r) => r.ok && setIds(Object.fromEntries(r.data.launches.map((l: any) => [l.code, l.id]))));
  }, []);

  async function ask(question: string) {
    setBusy(true); setErr(""); setAns(null); setQ(question);
    const r = await api("/api/ai/ask", { body: { question, categoryId: catId } });
    setBusy(false);
    if (!r.ok) return setErr(r.error === "ai_unavailable" ? "This needs the Claude API. No API key is configured on the server." : r.message ?? "Failed");
    setAns(r.data);
  }
  const link = (text: string) =>
    text.split(/(\[?[LDH]-\d{3,4}\]?)/g).map((part, i) => {
      const code = part.replace(/[\[\]]/g, "");
      return ids[code] ? <Link key={i} className="mono" href={`/launches/${ids[code]}`}>{part}</Link> : <span key={i}>{part}</span>;
    });

  return (
    <>
      <h1>Ask the history</h1>
      <p className="sub">Questions about past launches, answered by Claude from the trial records. Every launch it relies on is cited, and each citation is checked against what it actually looked up.</p>
      <div className="card">
        <label htmlFor="q">Your question</label>
        <textarea id="q" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button disabled={busy || !q.trim() || !catId} onClick={() => ask(q)}>{busy ? "Looking…" : "Ask"}</button>
          {EXAMPLES.map((e) => <button key={e} className="ghost" disabled={busy || !catId} onClick={() => ask(e)}>{e.length > 48 ? e.slice(0, 46) + "…" : e}</button>)}
        </div>
      </div>
      {err && <div className="msg err">{err}</div>}
      {ans && (
        <div className="card">
          <div className="quote" style={{ whiteSpace: "pre-wrap" }}>{link(ans.answer)}</div>
          <div className="small muted">Looked up with: {ans.toolsUsed.join(", ") || "no tools"}</div>
          {ans.invalidCitations.length > 0 && <div className="msg warn">These citations were not found in the records and should be ignored: {ans.invalidCitations.join(", ")}</div>}
        </div>
      )}
    </>
  );
}

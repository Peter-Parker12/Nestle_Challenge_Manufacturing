"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { api } from "./api";

type Msg = { role: "user" | "assistant"; content: string; invalid?: string[]; citations?: { tag: string; kind: string; id: string; valid: boolean }[] };
const PROMPTS = [
  "What should I do first on this filler?",
  "Valve 3 keeps giving fill weight alarms. What do I check?",
  "Van rót số 3 báo lỗi trọng lượng liên tục, tôi nên kiểm tra gì?",
];

function Rendered({ m }: { m: Msg }) {
  const bad = new Set(m.invalid ?? []);
  const parts = m.content.split(/(\[(?:A|G|P|L):[A-Za-z0-9._-]+\])/g);
  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) => {
        const t = /^\[(A|G|P|L):(.+)\]$/.exec(p);
        if (!t) return <span key={i}>{p}</span>;
        if (bad.has(p)) return <span key={i} className="badge b-red" title="This reference was not found in the data the assistant was given">{t[2]} ?</span>;
        return t[1] === "G" ? <Link key={i} className="badge b-blue" href={`/line-health/guides?code=${t[2]}`}>{t[2]}</Link> : t[1] === "L" ? <Link key={i} className="badge b-blue" href="/launches">{t[2]}</Link> : <span key={i} className={`badge ${t[1] === "A" ? "b-amber" : "b-gray"}`}>{t[2]}</span>;
      })}
    </div>
  );
}

export default function HeyFiller({ fillerId, enabled, endpoint = "/api/line-health/chat", title = "Hey, Filler", prompts = PROMPTS, intro, placeholder = "Ask about the filler…" }: { fillerId?: string; enabled: boolean; endpoint?: string; title?: string; prompts?: string[]; intro?: string; placeholder?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  async function send(t: string) {
    const content = t.trim();
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next); setText(""); setBusy(true); setErr(null);
    const r = await api(endpoint, { body: { ...(fillerId ? { filler: fillerId } : {}), messages: next.slice(-10).map((m) => ({ role: m.role, content: m.content })) } });
    setBusy(false);
    if (!r.ok) return setErr(r.message ?? "The assistant could not answer.");
    setMsgs([...next, { role: "assistant", content: r.data.text || "I could not produce an answer.", invalid: r.data.invalid, citations: r.data.citations }]);
    setTimeout(() => end.current?.scrollIntoView({ block: "nearest" }), 50);
  }

  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="small muted">{intro ?? "Ask about this filler in English or Vietnamese. Answers use only the health data, alarms, seals and guides in this system, and cite them. It recommends; it never changes anything on the machine."}</p>
      {!enabled && <div className="msg info">The assistant needs the Claude API key (ANTHROPIC_API_KEY). The ranking and next actions above work without it.</div>}
      <div className="row" style={{ marginBottom: 8 }}>
        {prompts.map((p) => <button key={p} className="ghost small" disabled={!enabled || busy} onClick={() => send(p)}>{p}</button>)}
      </div>
      <div aria-live="polite" style={{ display: "grid", gap: 8 }}>
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "preview" : "quote"} style={m.role === "user" ? { marginLeft: 40 } : undefined}>
            <div className="small muted">{m.role === "user" ? "You" : title}</div>
            <Rendered m={m} />
            {m.invalid && m.invalid.length > 0 && <div className="msg warn small">Not found in the data: {m.invalid.join(", ")}. Treat those references as unverified.</div>}
          </div>
        ))}
        {busy && <div className="small muted">Checking the filler data…</div>}
        <div ref={end} />
      </div>
      {err && <div className="msg err" role="alert">{err}</div>}
      <form className="row" style={{ marginTop: 10, flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input aria-label={`Ask: ${title}`} value={text} maxLength={500} disabled={!enabled} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
        <button disabled={!enabled || busy || !text.trim()}>Ask</button>
      </form>
    </div>
  );
}

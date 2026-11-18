"use client";
import { useRef, useState } from "react";
import { api } from "./api";
import Cited from "./Cited";

type Msg = { role: "user" | "assistant"; content: string; invalid?: string[] };
const PROMPTS = [
  "Why does the Competitor A price move matter most?",
  "Competitor B có đang khuyến mãi ở eCom không?",
  "Which brand cut price in Hanoi?",
];

export default function Chat({ enabled }: { enabled: boolean }) {
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
    const r = await api("/api/ask", { body: { messages: next.slice(-10).map((m) => ({ role: m.role, content: m.content })) } });
    setBusy(false);
    if (!r.ok) return setErr(r.error === "ai_unavailable" ? "This needs the Claude API. No API key is configured on the server." : r.message ?? "The assistant could not answer.");
    setMsgs([...next, { role: "assistant", content: r.data.text || "I could not produce an answer.", invalid: r.data.invalid }]);
    setTimeout(() => end.current?.scrollIntoView({ block: "nearest" }), 50);
  }
  return (
    <div className="card">
      <h2>Ask the radar</h2>
      <p className="small muted">Ask about prices, promos, shelf and scenarios in English or Vietnamese. It reads data in this system only, cites it, and cannot accept a scenario or change anything.</p>
      {!enabled && <div className="msg info">The assistant needs the Claude API key (ANTHROPIC_API_KEY). The radar, scenarios and standard brief work without it.</div>}
      <div className="row" style={{ marginBottom: 8 }}>{PROMPTS.map((p) => <button key={p} className="ghost small" disabled={!enabled || busy} onClick={() => send(p)}>{p}</button>)}</div>
      <div aria-live="polite" style={{ display: "grid", gap: 8 }}>
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "preview" : "quote"} style={m.role === "user" ? { marginLeft: 40 } : undefined}>
            <div className="small muted">{m.role === "user" ? "You" : "Ask the radar"}</div>
            <Cited text={m.content} invalid={m.invalid} />
            {m.invalid && m.invalid.length > 0 && <div className="msg warn small">Not found in the data: {m.invalid.join(", ")}. Treat those references as unverified.</div>}
          </div>
        ))}
        {busy && <div className="small muted">Checking the data…</div>}
        <div ref={end} />
      </div>
      {err && <div className="msg err" role="alert">{err}</div>}
      <form className="row" style={{ marginTop: 10, flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input aria-label="Ask the radar" value={text} maxLength={500} disabled={!enabled} placeholder="Ask about a price, promo or shelf…" onChange={(e) => setText(e.target.value)} />
        <button disabled={!enabled || busy || !text.trim()}>Ask</button>
      </form>
    </div>
  );
}

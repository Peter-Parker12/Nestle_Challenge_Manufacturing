"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

export default function RefreshButton({ allowed }: { allowed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    const r = await api("/api/radar/refresh", { method: "POST" });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: `${r.data.created} new move${r.data.created === 1 ? "" : "s"}, ${r.data.existing} already known (data as of ${r.data.asOf}).` } : { ok: false, text: r.message ?? "Failed" });
    router.refresh();
  }
  return (
    <div style={{ textAlign: "right" }}>
      <button className="ghost" disabled={busy || !allowed} title={allowed ? undefined : "Your role cannot refresh the radar"} onClick={go}>{busy ? "Refreshing…" : "Refresh now"}</button>
      {msg && <div className={`small ${msg.ok ? "muted" : ""}`} role="status" style={{ marginTop: 4, color: msg.ok ? undefined : "var(--bad)" }}>{msg.text}</div>}
    </div>
  );
}

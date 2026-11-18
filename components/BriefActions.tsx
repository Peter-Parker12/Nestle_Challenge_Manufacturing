"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

export default function BriefActions({ allowed }: { allowed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(language: "en" | "vi") {
    setBusy(true); setErr(null);
    const r = await api("/api/briefs", { body: { language } });
    setBusy(false);
    if (!r.ok) return setErr(r.message ?? "Failed");
    router.push(`/brief?id=${r.data.id}`); router.refresh();
  }
  return (
    <div>
      <div className="row"><button disabled={busy || !allowed} onClick={() => go("en")}>{busy ? "Writing…" : "Write today's brief"}</button><button className="ghost" disabled={busy || !allowed} onClick={() => go("vi")}>Tiếng Việt</button></div>
      {err && <div className="msg err" role="alert">{err}</div>}
    </div>
  );
}

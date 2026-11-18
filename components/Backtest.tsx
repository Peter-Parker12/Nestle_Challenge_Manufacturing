"use client";
import { useState } from "react";
import { api } from "./api";

export default function Backtest() {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); const r = await api("/api/backtest"); setBusy(false); if (r.ok) setD(r.data); }
  return (
    <div>
      <button className="ghost" onClick={go} disabled={busy}>{busy ? "Replaying…" : "Run the backtest"}</button>
      {d && <>
        <p style={{ marginTop: 12 }}><strong>{d.caught} of {d.total}</strong> planted events were flagged{d.medianDaysToFlag != null ? `, at a median of ${d.medianDaysToFlag} days after they began` : ""}.</p>
        <div className="tw"><table>
          <thead><tr><th>Event</th><th>Channel</th><th>Began</th><th>Flagged</th></tr></thead>
          <tbody>{d.events.map((e: any, i: number) => <tr key={i}><td>{e.note}</td><td>{e.channel}</td><td>{e.started_on}</td><td>{e.caught ? <span className="badge b-green">{e.days_to_flag === 0 ? "same day" : `after ${e.days_to_flag} days`}</span> : <span className="badge b-red">missed</span>}</td></tr>)}</tbody>
        </table></div>
        <div className="msg info small">{d.note}</div>
      </>}
    </div>
  );
}

import Link from "next/link";

const lvl = (l: string) => (l === "High" ? "b-red" : l === "Medium" ? "b-amber" : "b-green");

/** The explained score for one position: every factor, its weight and the points it adds. */
export default function RiskPanel({ risk }: { risk: any }) {
  if (!risk) return <div className="card"><h2>Risk</h2><p className="muted" style={{ margin: 0 }}>No seal is fitted, so there is nothing to score.</p></div>;
  const r = risk.result;
  const rec = risk.recommendedStop;
  const when = risk.projectedDays === 0 ? "High now" : risk.projectedDays == null ? "Not expected to reach High within a year at the recent rate of use" : `Projected to reach High on ${risk.projectedHighOn} (about ${risk.projectedDays} days), if used at the recent rate`;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Risk <span className={`badge ${lvl(r.level)}`}>{r.level}</span> <span style={{ fontFamily: "var(--font-head)" }}>{r.score}</span><span className="muted small"> / 100</span></h2>
        {risk.alert && <Link className="small" href="/risk">Alert: {risk.alert.state}</Link>}
      </div>
      <p style={{ margin: "6px 0" }}>{when}.</p>
      <p className="small muted" style={{ margin: "0 0 10px" }}>
        Suggested stop: {rec.stop ? <>{rec.stop.start_on}{rec.stop.end_on !== rec.stop.start_on ? ` to ${rec.stop.end_on}` : ""} ({rec.stop.kind}). {rec.note}</> : rec.note}
      </p>
      <div className="tw"><table>
        <thead><tr><th>Factor</th><th>What the data says</th><th>Weight</th><th style={{ minWidth: 120 }}>Value</th><th>Points</th></tr></thead>
        <tbody>
          {r.factors.map((f: any) => (
            <tr key={f.key} style={f.missing || f.weight === 0 ? { opacity: 0.55 } : undefined}>
              <td>{f.label}</td>
              <td className="small">{f.note}{f.missing ? " (left out)" : ""}{f.weight === 0 && !f.missing ? " (weight 0)" : ""}</td>
              <td>{f.weight}</td>
              <td>{f.value != null ? <div className="bar"><i style={{ width: `${Math.round(f.value * 100)}%` }} /></div> : "–"}</td>
              <td><strong>{f.points}</strong></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Weighted share {r.base} × criticality multiplier {r.multiplier} (criticality {risk.criticality}).
        {r.floors.map((f: any) => <span key={f.rule}> <strong>Floor {f.rule}:</strong> {f.text}.</span>)}
        {r.missing.length > 0 && <> Left out for lack of data: {r.missing.join(", ")}.</>}
      </p>
    </div>
  );
}

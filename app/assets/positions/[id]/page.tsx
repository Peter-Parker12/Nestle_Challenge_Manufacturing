import Link from "next/link";
import { notFound } from "next/navigation";
import PositionActions from "@/components/PositionActions";
import { Life, RATING, critClass, ratingClass, reasonLabel } from "@/components/assetUi";
import { getPosition } from "@/lib/assets";
import RiskPanel from "@/components/RiskPanel";
import { getUser } from "@/lib/auth";
import { positionRisk } from "@/lib/risk";
import { alarmsForPosition } from "@/lib/linehealth";
import { q1 } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getPosition>>;
  try { d = await getPosition(id); } catch { notFound(); }
  const user = await getUser();
  const risk = await positionRisk(id);
  const stationAlarms = await alarmsForPosition(id);
  const { position: p, history, incidents, partTypes } = d;
  const seq = (await q1<{ n: number }>("select coalesce(max(substring(code from '[0-9]{1,9}$')::int),0)+1 as n from ast.part where code ~ '[0-9]+$'"))!.n;
  const closed = history.filter((h: any) => h.removed_on);
  const avgLife = closed.length ? Math.round(closed.reduce((s: number, h: any) => s + h.days_in_service, 0) / closed.length) : null;
  return (
    <>
      <div className="eyebrow"><Link href={`/assets?line=${p.line_code}`}>{p.line_code}</Link> · {p.equipment_name} · {p.assembly}</div>
      <h1>{p.position_name}</h1>
      <p className="sub">{p.seal_function ?? "Seal position"} <span className={`pill ${critClass(p.criticality)}`} title="Criticality: consequence of a failure here">C{p.criticality}</span>{p.position_status === "Retired" && <span className="badge b-gray" style={{ marginLeft: 8 }}>Retired</span>}</p>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card kpi"><div className="l">Seal now</div><div className="v" style={{ fontSize: 18 }}>{p.part_code ? <Link className="mono" href={`/assets/parts/${p.part_id}`}>{p.part_code}</Link> : "Empty"}</div><div className="d">{p.part_type_code ?? ""} {p.material ?? ""}</div></div>
        <div className="card kpi"><div className="l">Age against planned life</div><div style={{ marginTop: 8 }}><Life age={p.age_days} nominal={p.nominal_life_days} /></div></div>
        <div className="card kpi"><div className="l">Last inspection</div><div className="v" style={{ fontSize: 18 }}>{p.last_rating ? <span className={`badge ${ratingClass(p.last_rating)}`}>{RATING[p.last_rating]}</span> : "None"}</div><div className="d">{p.last_inspected_on ?? "not inspected yet"}</div></div>
        <div className="card kpi"><div className="l">Seals used here</div><div className="v">{history.length}</div><div className="d">{avgLife ? `average ${avgLife} days in service` : "no completed history"}</div></div>
      </div>

      {stationAlarms.map((a: any) => (
        <div key={a.station_id} className={`msg ${a.faults14 > 0 ? "warn" : "info"}`}>
          Filler alarms at {a.station}, last 14 days: <strong>{a.n14}</strong>{a.faults14 > 0 ? ` (${a.faults14} faults)` : ""}{a.top_code ? `, mostly ${a.top_code}` : ""}. <Link href={`/line-health/stations/${a.station_id}`}>Open the station</Link>
        </div>
      ))}
      <RiskPanel risk={risk} />

      {p.position_status === "Active" && <PositionActions role={user.role} positionId={id} hasSeal={!!p.part_id} partTypes={partTypes} defaultTypeId={p.part_type_id ?? undefined} nextCode={`S-${p.part_type_code ?? "NEW"}-${seq}`} />}

      <div className="card">
        <h2>Seal history at this position</h2>
        <div className="tw"><table>
          <thead><tr><th>Part</th><th>Fitted</th><th>Removed</th><th>Days</th><th>Planned</th><th>Reason</th><th>Inspections</th><th>Worst rating</th></tr></thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={8} className="muted">No seal has been fitted here yet.</td></tr>}
            {history.map((h: any) => (
              <tr key={h.installation_id}>
                <td><Link className="mono" href={`/assets/parts/${h.part_id}`}>{h.part_code}</Link></td>
                <td>{h.installed_on}</td><td>{h.removed_on ?? <span className="badge b-green">in service</span>}</td>
                <td>{h.days_in_service}</td><td>{h.nominal_life_days}</td>
                <td>{h.removal_reason ? <span className={`badge ${h.removal_reason === "failure" ? "b-red" : "b-gray"}`}>{reasonLabel(h.removal_reason)}</span> : ""}</td>
                <td>{h.inspections}</td>
                <td>{h.worst_rating ? <span className={`badge ${ratingClass(h.worst_rating)}`}>{RATING[h.worst_rating]}</span> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <h2>Incidents at this position</h2>
        {incidents.length === 0 ? <p className="muted" style={{ margin: 0 }}>None recorded.</p> : (
          <div className="tw"><table>
            <thead><tr><th>Date</th><th>Kind</th><th>Severity</th><th>Seal</th><th>What happened</th><th>Reported by</th></tr></thead>
            <tbody>{incidents.map((n: any) => (
              <tr key={n.id}><td>{n.occurred_on}</td><td>{reasonLabel(n.kind)}</td><td><span className={`badge ${n.severity === "Minor" ? "b-gray" : n.severity === "Major" ? "b-amber" : "b-red"}`}>{n.severity}</span></td><td className="mono">{n.part_code ?? ""}</td><td>{n.description}</td><td>{n.reported_by ?? ""}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import SettingsPanel from "@/components/SettingsPanel";
import Spark from "@/components/Spark";
import { getUser } from "@/lib/auth";
import { stationDetail } from "@/lib/linehealth";

export const dynamic = "force-dynamic";
const lvl = (l: string) => (l === "High" ? "b-red" : l === "Medium" ? "b-amber" : "b-green");
const fmt = (t: any) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

export default async function Station({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let d: Awaited<ReturnType<typeof stationDetail>>;
  try { d = await stationDetail(id); } catch { notFound(); }
  const user = await getUser();
  const { station, health: h, byCode, alarms, breakdowns, defects, tasks, settings, corrections, guides } = d;
  return (
    <>
      <div className="eyebrow"><Link href="/line-health">Filler health</Link> · {station.line_code} · {station.equipment_name}</div>
      <h1>{station.name} <span className={`badge ${lvl(h.level)}`}>{h.level}</span> <span style={{ fontFamily: "var(--font-head)" }}>{h.score}</span></h1>
      <p className="sub">{h.prediction.text}</p>

      <div className="grid g2">
        <div className="card">
          <h2>What to do</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{h.actions.map((a, i) => <li key={i}>{a.text} {a.ref?.type === "position" && <Link href={`/assets/positions/${a.ref.id}`}>Open the seal</Link>}{a.ref?.type === "guide" && <Link href={`/line-health/guides?code=${a.ref.code}`}>Open the guide</Link>}</li>)}</ul>
          <h3>Alarms per week, last 8 weeks</h3>
          <Spark values={h.weeklyAlarms} faults={h.weeklyFaults} label="Alarms per week" />
          <p className="small muted" style={{ marginBottom: 0 }}>Faults per week: {h.weeklyFaults.join(", ")}.</p>
        </div>
        <div className="card">
          <h2>Why this score</h2>
          <div className="tw"><table>
            <thead><tr><th>Factor</th><th>Evidence</th><th>Points</th></tr></thead>
            <tbody>{h.factors.map((f) => <tr key={f.key} style={f.missing ? { opacity: 0.55 } : undefined}><td>{f.label}</td><td className="small">{f.note}{f.missing ? " (left out)" : ""}</td><td><strong>{f.points}</strong></td></tr>)}</tbody>
          </table></div>
          {h.seal && <p className="small" style={{ marginBottom: 0 }}>Seal in this assembly: <Link href={`/assets/positions/${h.seal.positionId}`}>{h.seal.name} ({h.seal.partCode})</Link>, risk {h.seal.level} ({h.seal.score}).</p>}
        </div>
      </div>

      <div className="card">
        <h2>Settings</h2>
        {settings.length === 0 ? <p className="muted" style={{ margin: 0 }}>No settings are tracked for this station.</p> : <SettingsPanel role={user.role} settings={settings} />}
        {corrections.length > 0 && <details style={{ marginTop: 10 }}><summary className="small">Changes recorded ({corrections.length})</summary>
          <div className="tw"><table><tbody>{corrections.map((c: any, i: number) => <tr key={i}><td>{fmt(c.applied_at)}</td><td>{c.setting}: {Number(c.from_value)} → {Number(c.to_value)}</td><td>{c.reason}</td><td>{c.by}</td></tr>)}</tbody></table></div></details>}
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Alarms, last 30 days</h2>
          <div className="tw"><table>
            <thead><tr><th>Code</th><th>Alarm</th><th>Count</th><th>Faults</th><th>Guide</th></tr></thead>
            <tbody>
              {byCode.length === 0 && <tr><td colSpan={5} className="muted">No alarms.</td></tr>}
              {byCode.map((a: any) => { const g = guides.find((x: any) => x.alarm_codes.includes(a.code)); return <tr key={a.code}><td className="mono">{a.code}</td><td>{a.description}</td><td>{a.n}</td><td>{a.faults}</td><td>{g ? <Link href={`/line-health/guides?code=${g.code}`}>{g.code}</Link> : <span className="muted">none</span>}</td></tr>; })}
            </tbody>
          </table></div>
          <details style={{ marginTop: 8 }}><summary className="small">Latest events</summary>
            <div className="tw"><table><tbody>{alarms.slice(0, 25).map((a: any, i: number) => <tr key={i}><td className="small">{fmt(a.occurred_at)}</td><td className="mono">{a.code}</td><td><span className={`badge ${a.severity === "Fault" ? "b-red" : a.severity === "Warning" ? "b-amber" : "b-gray"}`}>{a.severity}</span></td></tr>)}</tbody></table></div></details>
        </div>
        <div className="card">
          <h2>Breakdowns, maintenance and defects</h2>
          <h3>Breakdowns</h3>
          {breakdowns.length === 0 ? <p className="muted small">None recorded.</p> : <div className="tw"><table><tbody>{breakdowns.map((b: any, i: number) => <tr key={i}><td className="small">{fmt(b.started_at).slice(0, 10)}</td><td>{b.minutes} min</td><td>{b.cause}<div className="small muted">{b.fix}</div></td></tr>)}</tbody></table></div>}
          <h3>Maintenance</h3>
          <div className="tw"><table><tbody>{tasks.map((t: any) => <tr key={t.id}><td>{t.kind}</td><td>{t.title}</td><td>{t.due_on}</td><td>{t.done_on ? <span className="badge b-green">done {t.done_on}</span> : t.overdue ? <span className="badge b-red">overdue</span> : <span className="badge b-gray">open</span>}</td></tr>)}</tbody></table></div>
          <h3>Defects, 30 days</h3>
          <p className="small" style={{ marginBottom: 0 }}>{defects.length ? `${defects.reduce((n: number, x: any) => n + x.qty, 0)} in total: ${[...new Set(defects.map((x: any) => x.kind))].join(", ")}.` : "None."}</p>
        </div>
      </div>

      {guides.length > 0 && (
        <div className="card">
          <h2>Troubleshooting guides for these alarms</h2>
          {guides.map((g: any) => (
            <details key={g.code} open={guides.length === 1}><summary><strong>{g.code}</strong> · {g.title}</summary>
              <ol>{(g.steps as any[]).map((s) => <li key={s.n}>{s.text}</li>)}</ol><p className="small muted">Source: {g.source}</p></details>
          ))}
        </div>
      )}
    </>
  );
}

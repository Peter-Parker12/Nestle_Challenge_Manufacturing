import Link from "next/link";
import HeyFiller from "@/components/HeyFiller";
import Spark from "@/components/Spark";
import { aiEnabled } from "@/lib/ai/client";
import { fillerHealth, listFillers } from "@/lib/linehealth";

export const dynamic = "force-dynamic";
const lvl = (l: string) => (l === "High" ? "b-red" : l === "Medium" ? "b-amber" : "b-green");

function Kpi({ label, now, base, unit, lowerIsBetter }: { label: string; now: any; base: any; unit: string; lowerIsBetter?: boolean }) {
  const d = now != null && base != null ? Number(now) - Number(base) : null;
  const good = d == null ? null : lowerIsBetter ? d <= 0 : d >= 0;
  return (
    <div className="card kpi"><div className="l">{label}, last 7 days</div><div className="v">{now ?? "–"}{unit}</div>
      <div className="d">{d == null ? "" : <span className={`badge ${good ? "b-green" : "b-amber"}`}>{d > 0 ? "+" : ""}{Math.round(d * 10) / 10} vs usual</span>}</div></div>
  );
}

export default async function LineHealth({ searchParams }: { searchParams: Promise<{ filler?: string }> }) {
  const sp = await searchParams;
  const fillers = await listFillers();
  const f = fillers.find((x) => x.id === sp.filler) ?? fillers[0];
  if (!f) return <><h1>Filler health</h1><p className="sub">No filler is set up yet. Add one in Plant setup.</p></>;
  const h = await fillerHealth(f.id);
  const k = h.kpis as any;
  return (
    <>
      <div className="eyebrow">Line health · DNF-2</div>
      <h1>Filler health</h1>
      <p className="sub">One prioritised view of the filler: which station needs attention first, the evidence, what to do, and whether a stoppage is building. Scores combine alarms, downtime, defects, overdue maintenance and the condition of the seals in the same assembly. This pilot covers one filler; the predictions are trends from this machine&apos;s earlier stops, not a trained model.</p>
      {fillers.length > 1 && <div className="row" style={{ marginBottom: 14 }}>{fillers.map((x) => <Link key={x.id} className={`btn small ${x.id === f.id ? "" : "ghost"}`} href={`/line-health?filler=${x.id}`}>{x.line_code} · {x.name}</Link>)}</div>}

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Kpi label="eUPS" now={k.eups7} base={k.eups_base} unit="%" />
        <Kpi label="Speed" now={k.speed7} base={k.speed_base} unit="%" />
        <Kpi label="Unplanned downtime" now={k.down7} base={k.down_base} unit=" min" lowerIsBetter />
        <Kpi label="Material loss" now={k.loss7} base={k.loss_base} unit=" kg" lowerIsBetter />
      </div>

      <div className="card">
        <h2>Stations, most urgent first</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {h.stations.map((s) => (
            <div key={s.stationId} className="asm">
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                <h3 style={{ margin: 0 }}><Link href={`/line-health/stations/${s.stationId}`}>{s.name}</Link> <span className={`badge ${lvl(s.level)}`}>{s.level}</span> <span style={{ fontFamily: "var(--font-head)" }}>{s.score}</span></h3>
                <Spark values={s.weeklyAlarms} faults={s.weeklyFaults} label={`Alarms per week at ${s.name}`} />
              </div>
              {s.level !== "Low" && <>
                <div className="small muted" style={{ marginTop: 4 }}>
                  Evidence: {s.factors.filter((x) => x.points > 0).sort((a, b) => b.points - a.points).slice(0, 4).map((x) => `${x.label.toLowerCase()} (${x.note})`).join("; ")}.
                </div>
                {s.prediction.status !== "not_rising" && s.prediction.status !== "unknown" && <div className="msg warn small" style={{ margin: "6px 0" }}>{s.prediction.text}</div>}
              </>}
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {s.actions.map((a, i) => <li key={i} className="small">{a.text} {a.ref?.type === "position" && <Link href={`/assets/positions/${a.ref.id}`}>Seal</Link>}{a.ref?.type === "guide" && <Link href={`/line-health/guides?code=${a.ref.code}`}>Guide</Link>}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Bars are alarms per week for the last 8 weeks; the red bar is the latest 7 days. Open a station for alarms, breakdowns, settings and guides.</p>
      </div>
      <HeyFiller fillerId={f.id} enabled={aiEnabled()} />
    </>
  );
}

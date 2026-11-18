import Link from "next/link";
import DecisionPanel from "@/components/DecisionPanel";
import PriceChart from "@/components/PriceChart";
import { getUser } from "@/lib/auth";
import { KIND_LABEL, levelClass, pctText, price, vnd } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getMove } from "@/lib/radar";

export const dynamic = "force-dynamic";
const conf = (c: string) => (c === "High" ? "b-green" : c === "Medium" ? "b-amber" : "b-gray");

export default async function MovePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await getUser();
  const d = await getMove(code);
  const m = d.move;
  const last = d.decisions[0] ? { action: d.decisions[0].action as string, label: d.decisions[0].label as string, by: d.decisions[0].by_name as string, reason: d.decisions[0].reason as string | null, at: new Date(d.decisions[0].decided_at).toISOString() } : null;
  return (
    <>
      <div className="small"><Link href="/">Radar</Link> <span className="muted">/ {m.code}</span></div>
      <div className="row" style={{ marginTop: 6 }}>
        <span className={`badge ${levelClass(m.level)}`}>{m.level}</span><span className="badge b-gray">{m.channel_name}</span><span className="badge b-gray">{KIND_LABEL[m.kind]}</span>
        <span className="badge b-blue">Detected {m.detected_on}</span><span className="badge b-gray mono">{m.engine_version}</span>
      </div>
      <h1 style={{ marginTop: 8 }}>{m.title}</h1>
      <p className="sub">The detector flagged this from prices in the data feeds. The scenarios below are estimates with ranges. Nothing changes until a person decides.</p>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)", alignItems: "start", marginBottom: 14 }}>
        <section className="card">
          <h2>Shelf price, last 15 weeks</h2>
          <PriceChart series={d.chart.series} low={d.chart.usualLow} high={d.chart.usualHigh} movedLabel={`${m.brand} ${m.sku_code}`} ourLabel={`Nestlé ${m.nestle_code}`} />
          <div className="small muted" style={{ marginTop: 6 }}>Usual range = the competitor&apos;s median over the 8 weeks before, plus and minus 1.5 robust standard deviations. Sample data.</div>
        </section>
        <div style={{ display: "grid", gap: 14 }}>
          <section className="card">
            <div className="eyebrow">Exposure</div>
            <div className="kpi"><div className="v">{vnd(m.exposure_vnd)}<span className="small muted"> / week</span></div></div>
            <div className="small muted">Range {vnd(m.exposure_low)} to {vnd(m.exposure_high)}, from the elasticity interval</div>
            <table style={{ marginTop: 8 }}><tbody>
              <tr><td className="muted">Nestlé volume, last full week vs usual</td><td>{d.volume.changePct != null ? <strong style={{ color: d.volume.changePct < 0 ? "var(--bad)" : undefined }}>{pctText(d.volume.changePct)}</strong> : "–"}</td></tr>
              <tr><td className="muted">Retailers showing it</td><td>{Math.round(Number(m.coverage) * 100)}%</td></tr>
              {d.gapToUs != null && <tr><td className="muted">Competitor price vs ours</td><td>{pctText(d.gapToUs)}</td></tr>}
              <tr><td className="muted">Price elasticity (estimate)</td><td>{d.elasticity ? `${d.elasticity.value.toFixed(2)} (${d.elasticity.low.toFixed(2)} to ${d.elasticity.high.toFixed(2)})` : "–"}{d.elasticity?.method === "default" && <span className="badge b-amber" style={{ marginLeft: 6 }}>default</span>}</td></tr>
            </tbody></table>
          </section>
          <section className="card">
            <div className="eyebrow">Why it was flagged</div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
              {d.evidence.map((e: any, i: number) => (
                <li key={i}>{e.fact}{e.obsId && <> <span className="badge b-blue" title={e.obs ? `${e.obs.retailer}, ${e.obs.observed_on}, ${e.obs.source}` : undefined}>obs {e.obsId}</span></>}</li>
              ))}
              {m.z != null && <li>{Math.abs(Number(m.z))} robust standard deviations from that retailer&apos;s own history</li>}
            </ul>
          </section>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 14 }}>
        <h2>Response scenarios</h2>
        <div className="small muted" style={{ marginBottom: 10 }}>Impact per week over the next 4 weeks. Ranges come from the elasticity model, not from Claude.</div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
          {d.scenarios.map((s: any) => (
            <div key={s.id} className="asm">
              <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>{s.label}. {s.title}</h3><span className={`badge ${conf(s.confidence)}`}>{s.confidence}</span></div>
              <table><tbody>
                <tr><td className="muted">Volume</td><td><strong style={{ color: s.volume_pct < 0 ? "var(--bad)" : "var(--ok)" }}>{pctText(s.volume_pct)}</strong> <span className="muted small">({pctText(s.volume_low, 0)} to {pctText(s.volume_high, 0)})</span></td></tr>
                <tr><td className="muted">Margin</td><td><strong>{vnd(s.margin_vnd_wk)}</strong> / wk</td></tr>
                <tr><td className="muted">Cost</td><td>{s.cost_text}</td></tr>
              </tbody></table>
              <p className="small muted" style={{ margin: "6px 0 0" }}>{s.risk_text}</p>
              {s.needs_category_manager && <div className="small" style={{ marginTop: 6 }}><span className="badge b-amber">Category manager approval</span></div>}
            </div>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>
          Assumptions: elasticity {d.elasticity ? d.elasticity.value.toFixed(2) : "default"}, diversion rate and margin from Settings, competitor holds its new price, no change in other channels. {m.engine_version}.
        </div>
      </section>

      <DecisionPanel code={m.code} role={user.role} canDecide={can(user.role, "decide")} last={last}
        scenarios={d.scenarios.map((s: any) => ({ label: s.label, title: s.title, needsCM: s.needs_category_manager }))} />

      <section className="card" style={{ marginTop: 14 }}>
        <h2>History of this move</h2>
        <table><tbody>
          <tr><td className="mono">{m.detected_on}</td><td>Flagged {m.level} by the detector, {d.scenarios.length} scenarios built</td></tr>
          {d.decisions.slice().reverse().map((x: any) => <tr key={x.id}><td className="mono">{new Date(x.decided_at).toISOString().slice(0, 16).replace("T", " ")}</td><td><strong>{x.action}</strong> scenario {x.label} by {x.by_name}{x.reason ? `: ${x.reason}` : ""}</td></tr>)}
          {d.decisions.length === 0 && <tr><td className="muted">Waiting</td><td>Decision by a sales lead or category manager</td></tr>}
        </tbody></table>
      </section>
    </>
  );
}

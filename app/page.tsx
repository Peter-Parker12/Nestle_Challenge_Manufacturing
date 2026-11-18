import Link from "next/link";
import Cited from "@/components/Cited";
import RefreshButton from "@/components/RefreshButton";
import { can } from "@/lib/permissions";
import { getUser } from "@/lib/auth";
import { KIND_LABEL, levelClass, pctText, vnd } from "@/lib/format";
import { overview } from "@/lib/radar";

export const dynamic = "force-dynamic";
const CHANNELS = [["", "All channels"], ["GT", "General trade"], ["MT", "Modern trade"], ["ECOM", "eCom"]];

export default async function Radar({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const sp = await searchParams;
  const user = await getUser();
  const o = await overview();
  const moves = o.moves.filter((m: any) => !sp.channel || m.channel_code === sp.channel);
  const max = Math.max(1, ...moves.map((m: any) => m.exposure_vnd));
  const stale = (name: string, last: string | null) => !last || Date.now() - Date.parse(last) > 2 * 86400000;
  const brief = o.brief as any;
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="eyebrow">Sales · SALES-2</div>
          <h1>Market moves, today</h1>
          <p className="sub">What changed on price, promo, pack and shelf, ranked by how much Nestlé revenue it puts at risk. People decide every response.</p>
        </div>
        <div className="row"><span className="badge b-gray">Data as of {o.asOf ?? "–"}</span><RefreshButton allowed={can(user.role, "refresh")} /></div>
      </div>

      <div className="row" style={{ margin: "4px 0 14px" }} role="group" aria-label="Channel filter">
        {CHANNELS.map(([c, label]) => <Link key={c} className={`btn small ${(sp.channel ?? "") === c ? "" : "ghost"}`} href={c ? `/?channel=${c}` : "/"}>{label}</Link>)}
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card kpi"><div className="l">Moves, last 14 days</div><div className="v">{o.moves.length}</div><div className="d">{o.counts.High} High · {o.counts.Medium} Medium · {o.counts.Low} Low</div></div>
        <div className="card kpi"><div className="l">Revenue at risk</div><div className="v">{vnd(o.exposure)}<span className="small muted"> / wk</span></div><div className="d">Estimate; each move shows its range</div></div>
        <div className="card kpi"><div className="l">Waiting for a decision</div><div className="v">{o.waiting}</div><div className="d">High and Medium moves still open</div></div>
        <div className="card kpi"><div className="l">Shelf readings to check</div><div className="v">{o.pendingChecks}</div><div className="d"><Link href="/shelf">Read by AI, checked by a person</Link></div></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 2.1fr) minmax(280px, 1fr)", alignItems: "start" }}>
        <section className="card">
          <h2>Moves, ranked by exposure</h2>
          <div className="small muted" style={{ marginBottom: 6 }}>Exposure = Nestlé weekly revenue at that product and channel × size of the move × share of demand that switches</div>
          <div className="tw"><table>
            <thead><tr><th>Move</th><th>Channel</th><th>Change</th><th>Exposure / wk</th><th>Level</th><th>Status</th></tr></thead>
            <tbody>
              {moves.length === 0 && <tr><td colSpan={6} className="muted">No moves in this view. Refresh the radar after new prices arrive.</td></tr>}
              {moves.map((m: any) => (
                <tr key={m.id}>
                  <td><Link href={`/moves/${m.code}`}><strong>{m.title}</strong></Link><div className="small muted"><span className="mono">{m.code}</span> · {KIND_LABEL[m.kind]} · {m.sku_code}</div></td>
                  <td>{m.channel_name}</td>
                  <td>{m.change_pct != null ? <strong style={{ color: Number(m.change_pct) < 0 && m.kind !== "price_rise" ? "var(--bad)" : undefined }}>{pctText(m.change_pct)}</strong> : <span className="muted">{m.kind === "out_of_stock" ? `${Math.round(Number(m.coverage) * 100)}% of stores` : "–"}</span>}</td>
                  <td>{vnd(m.exposure_vnd)}<div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${Math.max(4, (m.exposure_vnd / max) * 100)}%` }} /></div></td>
                  <td><span className={`badge ${levelClass(m.level)}`}>{m.level}</span></td>
                  <td><span className={`badge ${m.status === "Open" ? "b-blue" : m.status === "Accepted" ? "b-green" : "b-gray"}`}>{m.status === "Open" ? `${m.n_scenarios} scenario${m.n_scenarios === 1 ? "" : "s"}` : m.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>

        <div style={{ display: "grid", gap: 14 }}>
          <section className="card navy">
            <div className="eyebrow" style={{ color: "#19d3cf" }}>Today&apos;s brief</div>
            {brief ? <>
              <h2>{brief.headline}</h2>
              <p className="small" style={{ lineHeight: 1.65 }}><Cited text={(brief.sections as any[])[0]?.text ?? ""} invalid={brief.invalid} /></p>
              <Link className="btn small" href="/brief">Read the full brief</Link>
            </> : <><h2>No brief yet</h2><Link className="btn small" href="/brief">Write today&apos;s brief</Link></>}
          </section>
          <section className="card">
            <h2>Price index vs Nestlé</h2>
            <div className="small muted" style={{ marginBottom: 8 }}>Competitor price per ml, Nestlé = 100. Below 100 means competitors are cheaper.</div>
            {o.priceIndex.map((p: any) => (
              <div key={p.code} style={{ marginBottom: 10 }}>
                <div className="row" style={{ justifyContent: "space-between" }}><span>{p.name}</span><strong style={{ color: Number(p.idx) < 97 ? "var(--bad)" : undefined }}>{Number(p.idx)}</strong></div>
                <div className="track"><div className="win" style={{ left: 0, width: `${Math.min(100, Number(p.idx) / 1.5)}%` }} /><div className="pt" style={{ left: `${100 / 1.5}%` }} /></div>
              </div>
            ))}
          </section>
          <section className="card">
            <h2>Data feeds</h2>
            {o.feeds.map((f: any) => (
              <div key={f.name} className="row" style={{ justifyContent: "space-between", padding: "3px 0" }}>
                <span>{f.name}</span><span className={`badge ${stale(f.name, f.last_run) ? "b-amber" : "b-green"}`}>{f.last_run ? `${Math.max(0, Math.round((Date.now() - Date.parse(f.last_run)) / 3600000))} h ago` : "never"}</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}

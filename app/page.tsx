import Link from "next/link";
import { badge } from "@/components/api";
import { dashboardKpis, listLaunches } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const k = await dashboardKpis();
  const launches = (await listLaunches()) as any[];
  const open = launches.filter((l) => !["Closed", "Cancelled"].includes(l.status));
  const base = k.groups.find((g: any) => g.used === false);
  const used = k.groups.find((g: any) => g.used === true);
  const fmt = (v: any, suffix = "") => (v === null || v === undefined ? "–" : `${v}${suffix}`);
  const delta = (a: any, b: any, lowerIsBetter = true) => {
    if (a == null || b == null) return null;
    const d = Number(b) - Number(a);
    if (d === 0) return "no change";
    const good = lowerIsBetter ? d < 0 : d > 0;
    return <span className={good ? "badge b-green" : "badge b-amber"}>{d > 0 ? "+" : ""}{Math.round(d * 100) / 100} vs history</span>;
  };

  return (
    <>
      <h1>Launch Accelerator</h1>
      <p className="sub">
        Recommends a starting recipe and process window for each new product launch, from similar past trials, and flags the risks. Engineers review and approve every plan.
      </p>

      <div className="grid g4">
        <div className="card kpi">
          <div className="l">First-pass rate (history)</div>
          <div className="v">{fmt(base?.first_pass_pct, "%")}</div>
          <div className="d">{base?.launches ?? 0} launches closed before the tool</div>
        </div>
        <div className="card kpi">
          <div className="l">Runs per launch (history)</div>
          <div className="v">{fmt(base?.avg_runs)}</div>
          <div className="d">Average trial runs until acceptance</div>
        </div>
        <div className="card kpi">
          <div className="l">Loss per launch (history)</div>
          <div className="v">{fmt(base?.avg_loss, " kg")}</div>
          <div className="d">Material lost across all runs</div>
        </div>
        <div className="card kpi">
          <div className="l">Days to acceptance (history)</div>
          <div className="v">{fmt(base?.avg_days)}</div>
          <div className="d">From request to Technical Acceptance</div>
        </div>
      </div>

      <div className="card navy" style={{ marginTop: 14 }}>
        <h2>With a recommendation</h2>
        {used ? (
          <div className="grid g4">
            <div className="kpi"><div className="l">First-pass rate</div><div className="v">{fmt(used.first_pass_pct, "%")}</div><div className="d">{delta(base?.first_pass_pct, used.first_pass_pct, false)}</div></div>
            <div className="kpi"><div className="l">Runs per launch</div><div className="v">{fmt(used.avg_runs)}</div><div className="d">{delta(base?.avg_runs, used.avg_runs)}</div></div>
            <div className="kpi"><div className="l">Loss per launch</div><div className="v">{fmt(used.avg_loss, " kg")}</div><div className="d">{delta(base?.avg_loss, used.avg_loss)}</div></div>
            <div className="kpi"><div className="l">Launches</div><div className="v">{used.launches}</div><div className="d">closed using a recommendation</div></div>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            No launch has been closed with a recommendation yet. Run the demo flow on the open launch below, and the comparison with history appears here.
            Small samples are not evidence; this view is for tracking the pilot, not for proving the method on synthetic data.
          </p>
        )}
        {k.usage && k.usage.decided > 0 && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Recommendations decided: {k.usage.decided}. Followed (approved or edited): {k.usage.followed}. Approved without edits: {k.usage.approved_as_is}.
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Open launches</h2>
          <Link className="btn" href="/launches/new">New launch</Link>
        </div>
        <div className="tw">
          <table>
            <thead><tr><th>Code</th><th>Product</th><th>Category</th><th>Line</th><th>Status</th><th>Runs</th><th>Last result</th></tr></thead>
            <tbody>
              {open.length === 0 && <tr><td colSpan={7} className="muted">No open launches.</td></tr>}
              {open.map((l) => (
                <tr key={l.id}>
                  <td><Link className="mono" href={`/launches/${l.id}`}>{l.code}</Link></td>
                  <td>{l.product}</td><td>{l.category}</td><td>{l.line}</td>
                  <td><span className={`badge ${badge(l.status)}`}>{l.status}</span></td>
                  <td>{l.runs}</td>
                  <td>{l.last_result ? <span className={`badge ${badge(l.last_result)}`}>{l.last_result}</span> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

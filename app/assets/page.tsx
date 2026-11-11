import Link from "next/link";
import { Life, PosLink, RATING, critClass, ratingClass } from "@/components/assetUi";
import { plantOverview } from "@/lib/assets";

export const dynamic = "force-dynamic";
type P = any;

export default async function PlantMap({ searchParams }: { searchParams: Promise<{ show?: string; line?: string }> }) {
  const sp = await searchParams;
  const show = sp.show ?? "all";
  const { lines, positions, kpis } = await plantOverview();
  const attention = (p: P) => (p.age_days != null && p.age_days > p.nominal_life_days) || (p.last_rating ?? 0) >= 4 || p.incidents_12m > 0;
  const keep = (p: P) => (show === "attention" ? attention(p) : show === "empty" ? !p.part_id : true) && (!sp.line || p.line_code === sp.line);
  const chip = (key: string, label: string) => <Link className={`btn small ${show === key ? "" : "ghost"}`} href={`/assets?show=${key}${sp.line ? `&line=${sp.line}` : ""}`}>{label}</Link>;

  return (
    <>
      <div className="eyebrow">Seals and gaskets · BAF-2</div>
      <h1>Plant map</h1>
      <p className="sub">
        Every place where a seal or gasket sits, grouped by line, machine and assembly, with the seal that is in it now. The bar shows the seal&apos;s age against its planned life (the mark). Risk scoring and alerts come in the next phase; today this is the record.
      </p>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card kpi"><div className="l">Positions</div><div className="v">{kpis.positions}</div><div className="d">{kpis.with_seal} with a seal fitted</div></div>
        <div className="card kpi"><div className="l">Average seal age</div><div className="v">{kpis.avg_age ?? "–"} d</div><div className="d">across fitted seals</div></div>
        <div className="card kpi"><div className="l">Past planned life</div><div className="v">{kpis.beyond_nominal}</div><div className="d">{kpis.nearing_nominal} more within 15%</div></div>
        <div className="card kpi"><div className="l">Incidents, 12 months</div><div className="v">{kpis.incidents_12m}</div><div className="d">{kpis.rated_poor} seals last rated damaged or failed</div></div>
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        {chip("all", "All positions")}{chip("attention", "Past life, rated poor or had an incident")}{chip("empty", "No seal fitted")}
        {lines.map((l: P) => <Link key={l.id} className={`btn small ${sp.line === l.code ? "" : "ghost"}`} href={`/assets?show=${show}${sp.line === l.code ? "" : `&line=${l.code}`}`}>{l.code}</Link>)}
      </div>
      {lines.map((l: P) => {
        const lp = positions.filter((p: P) => p.line_code === l.code && keep(p));
        const all = positions.filter((p: P) => p.line_code === l.code);
        if (sp.line && sp.line !== l.code) return null;
        const equipment = [...new Set(lp.map((p: P) => p.equipment_code))] as string[];
        return (
          <div className="card" key={l.id}>
            <h2>{l.name} <span className="muted small">({l.code})</span></h2>
            {all.length === 0 && <p className="muted" style={{ margin: 0 }}>No seals registered on this line yet. Add equipment in Plant setup, or import its history.</p>}
            {all.length > 0 && lp.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing matches this filter on this line.</p>}
            {equipment.map((ec) => {
              const ep = lp.filter((p: P) => p.equipment_code === ec);
              const asms = [...new Set(ep.map((p: P) => p.assembly))] as string[];
              return (
                <div key={ec} style={{ marginTop: 12 }}>
                  <h3>{ep[0].equipment_name} <span className="muted small">· {ep.length} {ep.length === 1 ? "position" : "positions"}</span></h3>
                  <div className="grid g3">
                    {asms.map((a) => (
                      <div className="asm" key={a}>
                        <h3>{a}</h3>
                        {ep.filter((p: P) => p.assembly === a).map((p: P) => (
                          <div key={p.position_id} style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
                            <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                              <PosLink id={p.position_id}>{p.position_name}</PosLink>
                              <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                                {p.incidents_12m > 0 && <span className="badge b-red" title="Incidents in 12 months">{p.incidents_12m} inc.</span>}
                                {p.last_rating != null && <span className={`badge ${ratingClass(p.last_rating)}`} title="Last inspection">{RATING[p.last_rating]}</span>}
                                <span className={`pill ${critClass(p.criticality)}`} title="Criticality: consequence of a failure here (1 low, 5 product contact)">C{p.criticality}</span>
                              </span>
                            </div>
                            <Life age={p.age_days} nominal={p.nominal_life_days} />
                            <div className="small muted">{p.part_code ? <Link href={`/assets/parts/${p.part_id}`}>{p.part_code}</Link> : "Empty"}{p.material ? ` · ${p.material}` : ""}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

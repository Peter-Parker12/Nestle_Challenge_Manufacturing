import Link from "next/link";
import { notFound } from "next/navigation";
import { reasonLabel } from "@/components/assetUi";
import { getPart } from "@/lib/assets";

export const dynamic = "force-dynamic";

export default async function Passport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getPart>>;
  try { d = await getPart(id); } catch { notFound(); }
  const { part, installs, events } = d;
  const current = installs.find((i: any) => !i.removed_on);
  const days = installs.reduce((n: number, i: any) => n + Math.round(((i.removed_on ? Date.parse(i.removed_on) : Date.now()) - Date.parse(i.installed_on)) / 86400000), 0);
  return (
    <>
      <div className="eyebrow">Seal passport</div>
      <h1><span className="mono" style={{ fontSize: 22 }}>{part.code}</span></h1>
      <p className="sub">{part.type_name} · {part.material}{part.supplier ? ` · ${part.supplier}` : ""}{part.lot ? ` · lot ${part.lot}` : ""}</p>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card kpi"><div className="l">Status</div><div className="v" style={{ fontSize: 20 }}>{part.status}</div></div>
        <div className="card kpi"><div className="l">Days in service</div><div className="v">{days}</div><div className="d">planned life {part.nominal_life_days} d</div></div>
        <div className="card kpi"><div className="l">Inspections</div><div className="v">{events.filter((e: any) => e.kind === "inspection").length}</div></div>
        <div className="card kpi"><div className="l">Incidents</div><div className="v">{events.filter((e: any) => e.kind === "incident").length}</div></div>
      </div>
      {current && <div className="msg info">Fitted now at <Link href={`/assets/positions/${current.position_id}`}>{current.line_code} · {current.assembly} · {current.position_name}</Link>.</div>}
      {!current && installs.length > 0 && (() => { const l = installs[installs.length - 1]; return <div className="msg info">Last fitted at <Link href={`/assets/positions/${l.position_id}`}>{l.line_code} · {l.assembly} · {l.position_name}</Link>, removed ({reasonLabel(l.removal_reason)}).</div>; })()}
      <div className="card">
        <h2>Timeline</h2>
        <ul className="timeline">
          {events.map((e: any, i: number) => (
            <li key={i} className={`${e.kind} ${e.tone ?? ""}`}>
              <div className="d">{e.date}</div>
              <div><strong>{e.title}</strong></div>
              {e.detail && <div className="small muted">{e.detail}</div>}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

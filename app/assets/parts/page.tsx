import Link from "next/link";
import { Life } from "@/components/assetUi";
import { listParts } from "@/lib/assets";

export const dynamic = "force-dynamic";
const statusClass: Record<string, string> = { Installed: "b-green", Removed: "b-gray", Scrapped: "b-red", Available: "b-blue" };

export default async function Register({ searchParams }: { searchParams: Promise<{ search?: string; status?: string }> }) {
  const sp = await searchParams;
  const parts = (await listParts(sp.search?.trim(), sp.status)) as any[];
  return (
    <>
      <div className="eyebrow">Seals and gaskets · BAF-2</div>
      <h1>Seal register</h1>
      <p className="sub">Every seal and gasket with its own passport: where it was fitted, inspections, incidents and why it came out. Open one to see its timeline.</p>
      <form className="row" style={{ marginBottom: 14 }}>
        <div className="field" style={{ minWidth: 260 }}><label htmlFor="s">Search part code, position or assembly</label><input id="s" name="search" defaultValue={sp.search ?? ""} placeholder="for example Filling valve 3" /></div>
        <div className="field"><label htmlFor="st">Status</label>
          <select id="st" name="status" defaultValue={sp.status ?? ""}><option value="">All</option>{["Installed", "Removed", "Scrapped", "Available"].map((s) => <option key={s}>{s}</option>)}</select></div>
        <button style={{ alignSelf: "flex-end" }}>Filter</button>
      </form>
      <div className="card">
        <div className="tw"><table>
          <thead><tr><th>Part</th><th>Type</th><th>Status</th><th>Now at</th><th>Age against planned life</th><th>Fitted</th></tr></thead>
          <tbody>
            {parts.length === 0 && <tr><td colSpan={6} className="muted">No seals match.</td></tr>}
            {parts.map((p) => (
              <tr key={p.id}>
                <td><Link className="mono" href={`/assets/parts/${p.id}`}>{p.code}</Link></td>
                <td>{p.type_code} <span className="muted small">{p.material}</span></td>
                <td><span className={`badge ${statusClass[p.status] ?? "b-gray"}`}>{p.status}</span></td>
                <td>{p.position_name ? <>{p.line_code} · {p.assembly} · {p.position_name}</> : <span className="muted">not in service</span>}</td>
                <td style={{ minWidth: 190 }}>{p.status === "Installed" ? <Life age={p.age_days} nominal={p.nominal_life_days} /> : ""}</td>
                <td>{p.installed_on ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {parts.length === 300 && <p className="small muted">Showing the first 300. Narrow the search.</p>}
      </div>
    </>
  );
}

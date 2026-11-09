import Link from "next/link";
import { badge } from "@/components/api";
import { listLaunches } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function Launches() {
  const rows = (await listLaunches()) as any[];
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Launches</h1>
          <p className="sub">Each launch is one attempt to bring a product to stable production on a line. It holds the recommendations and the trial runs.</p>
        </div>
        <Link className="btn" href="/launches/new">New launch</Link>
      </div>
      <div className="card tw">
        <table>
          <thead><tr><th>Code</th><th>Product</th><th>Category</th><th>Line</th><th>Status</th><th>Runs</th><th>Technical acceptance</th><th>Created</th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td><Link className="mono" href={`/launches/${l.id}`}>{l.code}</Link></td>
                <td>{l.product}</td><td>{l.category}</td><td>{l.line}</td>
                <td><span className={`badge ${badge(l.status)}`}>{l.status}</span></td>
                <td>{l.runs}</td>
                <td>{l.ta_decision ? <span className={`badge ${badge(l.ta_decision)}`}>{l.ta_decision}</span> : "–"}</td>
                <td className="small muted">{new Date(l.created_at).toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

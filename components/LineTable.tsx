import Link from "next/link";
import type { LineStatus } from "@/lib/plant";

const tone = (s: string) => (s === "Attention" ? "b-red" : s === "Watch" ? "b-amber" : "b-green");

/** One row per line, joining seals, filler and launches. */
export default function LineTable({ lines }: { lines: LineStatus[] }) {
  return (
    <div className="tw"><table>
      <thead><tr><th>Line</th><th>Status</th><th>Why</th><th>Next stop</th><th>Open launches</th></tr></thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.code}>
            <td><strong>{l.code}</strong><div className="small muted">{l.name}</div></td>
            <td><span className={`badge ${tone(l.state)}`}>{l.state}</span></td>
            <td className="small">
              {l.reasons.length === 0 ? <span className="muted">No open concerns</span> : l.reasons.map((r, i) => <div key={i}>{r}</div>)}
              <div>
                {l.seals.worst && <Link href={`/assets/positions/${l.seals.worst.positionId}`}>Worst seal</Link>}
                {l.seals.worst && l.filler && " · "}
                {l.filler && <Link href={`/line-health?filler=${l.filler.id}`}>Filler health</Link>}
              </div>
            </td>
            <td className="small">{l.nextStop ? `${l.nextStop.start_on} to ${l.nextStop.end_on} (${l.nextStop.kind})` : "None planned"}</td>
            <td className="small">{l.launches.length === 0 ? "–" : l.launches.map((x) => <div key={x.id}><Link className="mono" href={`/launches/${x.id}`}>{x.code}</Link> {x.status}</div>)}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

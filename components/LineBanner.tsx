import Link from "next/link";
import { launchLineContext } from "@/lib/plant";

/** On a launch: what the line itself looks like right now. Informs; never blocks. */
export default async function LineBanner({ launchId }: { launchId: string }) {
  const c = await launchLineContext(launchId);
  if (!c || !c.show) return null;
  const s = c.line;
  const tone = s.state === "Attention" ? "warn" : s.state === "Watch" ? "info" : "ok";
  return (
    <div className={`msg ${tone}`} style={{ marginBottom: 14 }}>
      <strong>Line {s.code}: {s.state === "OK" ? "no open concerns" : s.state === "Attention" ? "needs attention" : "watch"}.</strong>{" "}
      {s.reasons.join(" · ")}
      {c.advice.map((a, i) => <div key={i} className="small" style={{ marginTop: 4 }}>{a}</div>)}
      <div className="small" style={{ marginTop: 4 }}>
        <Link href="/risk">Seal risk</Link> · <Link href={s.filler ? `/line-health?filler=${s.filler.id}` : "/line-health"}>Filler health</Link> · <Link href="/assets/stops">Planned stops</Link>
        {" "}· This is information for the person planning the trial; it does not change the launch.
      </div>
    </div>
  );
}

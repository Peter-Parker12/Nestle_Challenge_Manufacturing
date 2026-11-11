import RiskBoard from "@/components/RiskBoard";
import { getUser } from "@/lib/auth";
import { riskBoard } from "@/lib/risk";

export const dynamic = "force-dynamic";

export default async function Risk() {
  const user = await getUser();
  const b = await riskBoard();
  // trim what is sent to the browser
  const ranked = b.ranked.map((r) => ({ positionId: r.positionId, lineCode: r.lineCode, assembly: r.assembly, positionName: r.positionName, lastRating: r.lastRating, projectedDays: r.projectedDays, projectedHighOn: r.projectedHighOn, recommendedStop: r.recommendedStop, result: { level: r.result.level, score: r.result.score, factors: r.result.factors.map((f) => ({ label: f.label, points: f.points })) } }));
  return (
    <>
      <div className="eyebrow">Seals and gaskets · BAF-2</div>
      <h1>Risk and alerts</h1>
      <p className="sub">Every seal gets an explained score from 0 to 100 from its age, run hours, CIP cycles, temperature and pressure exposure, inspections, history and incidents. Seals that need a change are matched to the planned stop to do it in. Engineers set the weights; people decide what to do with each alert.</p>
      <RiskBoard role={user.role} board={{ ...b, ranked, alerts: JSON.parse(JSON.stringify(b.alerts)) }} />
    </>
  );
}

import StopsManager from "@/components/StopsManager";
import { listStops } from "@/lib/assets";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Stops() {
  const user = await getUser();
  const lines = await q("select id, code, name from cfg.line order by code");
  const stops = await listStops();
  return (
    <>
      <div className="eyebrow">Seals and gaskets · BAF-2</div>
      <h1>Planned stops</h1>
      <p className="sub">One calendar of CIP, changeovers, maintenance windows and shutdowns per line. Seal replacements are planned into these stops, and the launch planner reads the same calendar so a trial is not booked on a line about to stop.</p>
      <StopsManager role={user.role} lines={lines} stops={stops as any[]} />
    </>
  );
}

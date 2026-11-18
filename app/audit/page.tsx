import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export default async function Audit() {
  const user = await getUser();
  if (!can(user.role, "viewAudit")) return <><h1>Audit log</h1><p className="sub">Your role ({user.role.replace("_", " ")}) cannot open the audit log. Sales leads, category managers and admins can.</p></>;
  const rows = await q(`select e.id, e.at, u.name as user_name, e.action, e.entity, e.entity_id, e.reason from audit.event e left join cfg.app_user u on u.id=e.user_id order by e.id desc limit 200`);
  return (
    <>
      <h1>Audit log</h1>
      <p className="sub">Every change to settings, moves, decisions, photos and readings, with who and why. The last 200 events.</p>
      <div className="card"><div className="tw"><table>
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th><th>Reason</th></tr></thead>
        <tbody>{rows.map((r: any) => <tr key={r.id}><td className="mono">{String(r.at).slice(0, 19)}</td><td>{r.user_name ?? "system"}</td><td>{r.action}</td><td className="mono">{r.entity}{r.entity_id ? ` ${String(r.entity_id).slice(0, 8)}` : ""}</td><td>{r.reason ?? ""}</td></tr>)}</tbody>
      </table></div></div>
    </>
  );
}

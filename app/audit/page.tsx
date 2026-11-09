import { auditEvents } from "@/lib/repo";
import { can } from "@/lib/permissions";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Audit() {
  const u = await getUser();
  if (!can(u.role, "viewAudit"))
    return (<><h1>Audit log</h1><div className="msg warn">Your role ({u.role.replace("_", " ")}) cannot view the audit log. Switch to QA, the category owner or the plant admin.</div></>);
  const rows = (await auditEvents(150)) as any[];
  return (
    <>
      <h1>Audit log</h1>
      <p className="sub">Every launch, run, recommendation, decision, weight and rule change, with who made it and why. The log is append-only: the database refuses edits and deletes.</p>
      <div className="card tw">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Reason</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="small mono">{new Date(e.at).toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{e.user_name ?? <span className="muted">system</span>}</td>
                <td><span className="badge b-gray">{e.action}</span></td>
                <td className="small"><span className="mono">{e.entity}</span>{e.after?.status ? ` → ${e.after.status}` : e.after?.result ? ` → ${e.after.result}` : e.after?.action ? ` → ${e.after.action}` : ""}</td>
                <td className="small">{e.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { q } from "@/lib/db";
export const dynamic = "force-dynamic";
export const GET = route(async () => { await requireRole("viewAudit"); return { events: await q(`select e.id, e.at, u.name as user_name, e.action, e.entity, e.entity_id, e.reason from audit.event e left join cfg.app_user u on u.id=e.user_id order by e.id desc limit 200`) }; });

import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { auditEvents } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const GET = route(async (req) => {
  await requireRole("viewAudit");
  const limit = Math.min(500, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 100)));
  return { events: await auditEvents(limit) };
});

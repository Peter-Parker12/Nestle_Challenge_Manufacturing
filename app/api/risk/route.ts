import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { refreshRisk, riskBoard } from "@/lib/risk";

export const dynamic = "force-dynamic";
export const GET = route(async () => riskBoard());
export const POST = route(async () => { const u = await requireRole("ackAlerts"); return refreshRisk(u.id); });

import { route } from "@/lib/api";
import { dashboardKpis } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const GET = route(async () => dashboardKpis());

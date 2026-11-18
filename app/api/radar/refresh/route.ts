import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { refreshRadar } from "@/lib/radar";
export const POST = route(async () => { const u = await requireRole("refresh"); return refreshRadar(u.id); });

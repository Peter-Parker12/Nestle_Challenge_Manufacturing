import { askInput, askRadar } from "@/lib/ai/ask";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
export const POST = route(async (req) => { const u = await requireRole("useAi"); return askRadar(u.id, await body(req, askInput)); });

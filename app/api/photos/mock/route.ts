import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { makeMockPhoto } from "@/lib/mockPhoto";
export const POST = route(async () => { const u = await requireRole("uploadPhoto"); return makeMockPhoto(u.id); });

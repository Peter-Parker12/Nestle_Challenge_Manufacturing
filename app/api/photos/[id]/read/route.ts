import { readShelfPhoto } from "@/lib/ai/vision";
import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
export const POST = route<{ id: string }>(async (_req, { id }) => { const u = await requireRole("useAi"); await requireRole("uploadPhoto"); return readShelfPhoto(u.id, id); });

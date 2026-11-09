import { rejectExtraction } from "@/lib/ai/features";
import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const u = await requireRole("extraction");
  await rejectExtraction(id, u.id);
  return { ok: true };
});

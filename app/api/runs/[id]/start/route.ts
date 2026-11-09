import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { startRun } from "@/lib/repo";

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const u = await requireRole("startRun");
  await startRun(id, u.id);
  return { ok: true };
});

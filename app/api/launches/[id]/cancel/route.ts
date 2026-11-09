import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { cancelLaunch } from "@/lib/repo";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("cancelLaunch");
  const { reason } = await body(req, z.object({ reason: z.string().min(1) }));
  await cancelLaunch(id, u.id, reason);
  return { ok: true };
});

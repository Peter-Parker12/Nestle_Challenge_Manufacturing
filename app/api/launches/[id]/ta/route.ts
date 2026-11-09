import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { recordTA } from "@/lib/repo";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("recordTA");
  const { decision } = await body(req, z.object({ decision: z.enum(["Accepted", "Accepted with conditions", "Rejected"]) }));
  await recordTA(id, u.id, decision);
  return { ok: true };
});

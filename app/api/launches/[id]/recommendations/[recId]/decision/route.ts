import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { decide } from "@/lib/repo";

const schema = z.object({
  action: z.enum(["approved", "edited", "rejected"]),
  finalValues: z.record(z.string(), z.number()).optional(),
  reason: z.string().max(1000).optional(),
});

export const POST = route<{ id: string; recId: string }>(async (req, { id, recId }) => {
  const u = await requireRole("decide");
  const d = await body(req, schema);
  return decide(id, recId, u.id, d);
});

import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { reviewRun } from "@/lib/repo";

const schema = z.object({
  reasons: z.array(z.string()).default([]),
  nextStep: z.enum(["TA", "Repeat", "Stop"]),
  overrideResult: z.enum(["Pass", "Marginal", "Fail"]).optional(),
  overrideReason: z.string().max(1000).optional(),
  comment: z.string().max(1000).optional(),
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("reviewRun");
  const d = await body(req, schema);
  return reviewRun(id, u.id, d);
});

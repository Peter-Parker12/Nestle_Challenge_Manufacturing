import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { enterResults } from "@/lib/repo";

const schema = z.object({
  actuals: z.record(z.string(), z.number()).default({}),
  quality: z.record(z.string(), z.number()).default({}),
  lossKg: z.number().nullable().optional(),
  lossNote: z.string().max(500).optional(),
  aborted: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("enterResults");
  const d = await body(req, schema);
  return enterResults(id, u.id, d);
});

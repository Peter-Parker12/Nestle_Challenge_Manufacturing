import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { saveRecipeWeights } from "@/lib/repo";

const schema = z.object({
  attributes: z.record(z.string(), z.number()).default({}),
  parameters: z.record(z.string(), z.number()).default({}),
  reason: z.string().min(1, "A reason is required"),
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("setRecipeWeights");
  const d = await body(req, schema);
  return saveRecipeWeights(id, u.id, { attributes: d.attributes, parameters: d.parameters }, d.reason);
});

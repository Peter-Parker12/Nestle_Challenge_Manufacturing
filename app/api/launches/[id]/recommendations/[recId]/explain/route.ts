import { z } from "zod";
import { explainRecommendation } from "@/lib/ai/features";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const POST = route<{ id: string; recId: string }>(async (req, { id, recId }) => {
  const u = await requireRole("useAi");
  const d = await body(req, z.object({ refresh: z.boolean().optional() }).default({}));
  return explainRecommendation(id, recId, u.id, { refresh: d.refresh });
});

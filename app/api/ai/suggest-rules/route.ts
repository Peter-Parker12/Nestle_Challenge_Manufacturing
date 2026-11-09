import { z } from "zod";
import { suggestRules } from "@/lib/ai/features";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const maxDuration = 120;

export const POST = route(async (req) => {
  const u = await requireRole("ruleDecision");
  const d = await body(req, z.object({ categoryId: z.string().uuid() }));
  return suggestRules(d.categoryId, u.id);
});

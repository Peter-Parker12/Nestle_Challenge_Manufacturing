import { z } from "zod";
import { decideRuleSuggestion } from "@/lib/ai/features";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("ruleDecision");
  const { accept } = await body(req, z.object({ accept: z.boolean() }));
  return decideRuleSuggestion(id, u.id, accept);
});

import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { createRecommendation } from "@/lib/repo";

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const u = await requireRole("recommend");
  const r = await createRecommendation(id, u.id);
  return { id: r.id, confidence: r.result.confidence, overallRisk: r.result.overallRisk, nMatched: r.result.nMatched };
});

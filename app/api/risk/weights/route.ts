import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { saveWeights } from "@/lib/risk";

export const POST = route(async (req) => {
  const u = await requireRole("riskWeights");
  const d = await body(req, z.object({ weights: z.record(z.string(), z.number()), reason: z.string().max(300) }));
  return saveWeights(u.id, d.weights, d.reason);
});

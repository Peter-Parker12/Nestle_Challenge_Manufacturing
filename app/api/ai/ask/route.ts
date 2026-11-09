import { z } from "zod";
import { askHistory } from "@/lib/ai/features";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const POST = route(async (req) => {
  const u = await requireRole("useAi");
  const d = await body(req, z.object({ question: z.string(), categoryId: z.string().uuid() }));
  return askHistory(d.question, d.categoryId, u.id);
});

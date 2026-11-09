import { z } from "zod";
import { parseRequest } from "@/lib/ai/features";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const POST = route(async (req) => {
  const u = await requireRole("useAi");
  const d = await body(req, z.object({ text: z.string(), categoryId: z.string().uuid() }));
  return parseRequest(d.text, d.categoryId, u.id);
});

import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { askFiller, chatInput } from "@/lib/ai/hey";

export const POST = route(async (req) => {
  const u = await requireRole("useAi");
  return askFiller(u.id, await body(req, chatInput));
});

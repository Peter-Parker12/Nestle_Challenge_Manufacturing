import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { askPlant, plantChatInput } from "@/lib/ai/plant";

export const POST = route(async (req) => {
  const u = await requireRole("useAi");
  return askPlant(u.id, await body(req, plantChatInput));
});

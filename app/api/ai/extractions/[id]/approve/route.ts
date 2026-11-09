import { approveExtraction } from "@/lib/ai/features";
import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const POST = route<{ id: string }>(async (_req, { id }) => {
  const u = await requireRole("extraction");
  return approveExtraction(id, u.id);
});

import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { recordCorrection } from "@/lib/linehealth";

/** A person records a setting change they made. The system never writes to the machine. */
export const POST = route(async (req) => {
  const u = await requireRole("applyCorrection");
  const d = await body(req, z.object({ settingId: z.string().uuid(), toValue: z.number(), reason: z.string().min(5).max(300) }));
  return recordCorrection(u.id, d.settingId, d.toValue, d.reason);
});

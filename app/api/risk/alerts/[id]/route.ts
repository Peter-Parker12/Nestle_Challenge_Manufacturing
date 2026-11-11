import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { transitionAlert } from "@/lib/risk";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("ackAlerts");
  const d = await body(req, z.object({ to: z.enum(["Acknowledged", "Planned", "Deferred", "Dismissed", "Done"]), reason: z.string().max(300).optional(), stopId: z.string().uuid().optional(), deferUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
  return transitionAlert(u.id, id, d);
});

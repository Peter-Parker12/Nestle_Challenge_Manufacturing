import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { decide } from "@/lib/radar";

const schema = z.object({ label: z.string().min(1).max(2), action: z.enum(["Accepted", "Rejected", "Deferred"]), reason: z.string().max(500).optional(), deferUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export const POST = route<{ code: string }>(async (req, { code }) => {
  const u = await requireRole("decide");
  await decide(u.id, code, await body(req, schema));
  return { ok: true };
});

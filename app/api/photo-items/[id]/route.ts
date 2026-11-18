import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { checkItem } from "@/lib/radar";
const schema = z.object({ action: z.enum(["confirm", "correct", "unreadable"]), price: z.number().positive().max(10_000_000).optional(), facings: z.number().int().min(0).max(40).optional(), reason: z.string().max(300).optional() });
export const POST = route<{ id: string }>(async (req, { id }) => { const u = await requireRole("checkReading"); await checkItem(u.id, id, await body(req, schema)); return { ok: true }; });

import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { EQUIPMENT_KINDS, createEquipment, createPartType, createPosition, setupLists } from "@/lib/assets";

export const dynamic = "force-dynamic";
export const GET = route(async () => setupLists());

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("equipment"), lineId: z.string().uuid(), code: z.string().min(1).max(40), name: z.string().min(2).max(80), kind: z.enum(EQUIPMENT_KINDS) }),
  z.object({ action: z.literal("position"), equipmentId: z.string().uuid(), code: z.string().min(1).max(40), name: z.string().min(2).max(80), assembly: z.string().min(2).max(80), sealFunction: z.string().max(80).optional(), criticality: z.number().int().min(1).max(5) }),
  z.object({ action: z.literal("partType"), code: z.string().min(1).max(40), name: z.string().min(2).max(80), material: z.string().min(2).max(40), supplier: z.string().max(80).optional(), nominalLifeDays: z.number().int().min(1).max(5000), specNote: z.string().max(300).optional() }),
]);

export const POST = route(async (req) => {
  const u = await requireRole("manageAssets");
  const d = await body(req, schema);
  if (d.action === "equipment") return createEquipment(u.id, d);
  if (d.action === "position") return createPosition(u.id, d);
  return createPartType(u.id, d);
});

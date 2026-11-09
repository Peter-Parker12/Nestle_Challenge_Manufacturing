import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import * as P from "@/lib/process";

export const dynamic = "force-dynamic";

/** Everyone may read the setup (it drives forms). Category owners and plant admins change it. */
export const GET = route<{ id: string }>(async (_req, { id }) => P.listProcess(id));

const num = z.number().finite();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("addStep"), name: z.string() }),
  z.object({ action: z.literal("addParameter"), stepId: z.string().uuid(), code: z.string(), name: z.string(), unit: z.string(), absMin: num, absMax: num, isCritical: z.boolean().optional(), isLocked: z.boolean().optional(), helpText: z.string().nullable().optional() }),
  z.object({ action: z.literal("updateParameter"), id: z.string().uuid(), patch: z.object({ name: z.string(), helpText: z.string().nullable(), isCritical: z.boolean(), isLocked: z.boolean(), absMin: num, absMax: num }).partial() }),
  z.object({ action: z.literal("setParameterStatus"), id: z.string().uuid(), status: z.enum(["Active", "Retired"]), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("setCapability"), lineId: z.string().uuid(), parameterId: z.string().uuid(), min: num, max: num }),
  z.object({ action: z.literal("addTest"), code: z.string(), name: z.string(), unit: z.string().nullable().optional(), isCritical: z.boolean().optional(), helpText: z.string().nullable().optional() }),
  z.object({ action: z.literal("updateTest"), id: z.string().uuid(), patch: z.object({ name: z.string(), unit: z.string().nullable(), isCritical: z.boolean(), helpText: z.string().nullable() }).partial() }),
  z.object({ action: z.literal("setTestStatus"), id: z.string().uuid(), status: z.enum(["Active", "Retired"]), reason: z.string().max(500).optional() }),
]);

export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("manageProcess");
  const d = await body(req, schema);
  switch (d.action) {
    case "addStep": return P.addStep(u.id, id, d.name);
    case "addParameter": return P.addParameter(u.id, id, d);
    case "updateParameter": return P.updateParameter(u.id, d.id, d.patch);
    case "setParameterStatus": return P.setParameterStatus(u.id, d.id, d.status, d.reason);
    case "setCapability": return P.setCapability(u.id, d.lineId, d.parameterId, d.min, d.max);
    case "addTest": return P.addTest(u.id, id, d);
    case "updateTest": return P.updateTest(u.id, d.id, d.patch);
    case "setTestStatus": return P.setTestStatus(u.id, d.id, d.status, d.reason);
  }
});

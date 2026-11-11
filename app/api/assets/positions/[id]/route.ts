import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { INCIDENT_KINDS, REMOVAL_REASONS, SEVERITIES, getPosition, recordIncident, recordInspection, replaceSeal, retirePosition } from "@/lib/assets";

export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>(async (_r, { id }) => getPosition(id));

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("replace"), partCode: z.string().min(1).max(40), partTypeId: z.string().uuid(), lot: z.string().max(40).optional(), installedOn: date, removalReason: z.enum(REMOVAL_REASONS).optional(), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("inspect"), inspectedOn: date, rating: z.number().int().min(1).max(5), finding: z.string().max(500).optional() }),
  z.object({ action: z.literal("incident"), occurredOn: date, kind: z.enum(INCIDENT_KINDS), severity: z.enum(SEVERITIES), description: z.string().max(500).optional() }),
  z.object({ action: z.literal("retire"), reason: z.string().min(3).max(200) }),
]);

export const POST = route<{ id: string }>(async (req, { id }) => {
  const d = await body(req, schema);
  if (d.action === "replace") { const u = await requireRole("recordSealWork"); return replaceSeal(u.id, { positionId: id, ...d }); }
  if (d.action === "inspect") { const u = await requireRole("recordInspection"); return recordInspection(u.id, { positionId: id, ...d }); }
  if (d.action === "incident") { const u = await requireRole("recordIncident"); return recordIncident(u.id, { positionId: id, ...d }); }
  const u = await requireRole("manageAssets");
  return retirePosition(u.id, id, d.reason);
});

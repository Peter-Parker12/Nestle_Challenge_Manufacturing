import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { setFieldStatus, updateField } from "@/lib/fields";

const schema = z.object({
  action: z.enum(["update", "activate", "retire", "reactivate"]),
  reason: z.string().max(500).optional(),
  patch: z.object({
    name: z.string(), unit: z.string().nullable(), choices: z.array(z.string()), absMin: z.number(), absMax: z.number(), required: z.boolean(),
    helpText: z.string().nullable(), section: z.string().nullable(), sortOrder: z.number().int(), aiVisible: z.boolean(), kind: z.enum(["matching", "info"]),
  }).partial().optional(),
});

export const PATCH = route<{ id: string; fieldId: string }>(async (req, { fieldId }) => {
  const u = await requireRole("manageFields");
  const d = await body(req, schema);
  if (d.action === "update") return updateField(u.id, fieldId, d.patch ?? {});
  if (d.action === "retire") return setFieldStatus(u.id, fieldId, "Retired", d.reason);
  return setFieldStatus(u.id, fieldId, "Active", d.reason);
});

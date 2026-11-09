import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { createField, listFields } from "@/lib/fields";

export const dynamic = "force-dynamic";

/** Everyone may read the field list (it drives the forms). Only category owners change it. */
export const GET = route<{ id: string }>(async (_req, { id }) => listFields(id));

const schema = z.object({
  code: z.string(), name: z.string(), type: z.enum(["numeric", "choice", "boolean", "text", "date"]),
  kind: z.enum(["matching", "info"]).optional(), unit: z.string().nullable().optional(), choices: z.array(z.string()).optional(),
  absMin: z.number().nullable().optional(), absMax: z.number().nullable().optional(), required: z.boolean().optional(),
  helpText: z.string().nullable().optional(), section: z.string().nullable().optional(), sortOrder: z.number().int().optional(),
  aiVisible: z.boolean().optional(), initialWeight: z.number().int().optional(),
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("manageFields");
  return createField(u.id, id, await body(req, schema));
});

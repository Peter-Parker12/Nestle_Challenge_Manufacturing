import { z } from "zod";
import { route } from "@/lib/api";
import { HttpError, requireRole } from "@/lib/auth";
import { recordInspectionFull } from "@/lib/assets";
import { IMAGE_TYPES } from "@/lib/ai/vision";

const schema = z.object({
  inspectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rating: z.coerce.number().int().min(1).max(5), finding: z.string().max(500).optional(),
  analysisId: z.string().uuid().optional(), overrideReason: z.string().max(300).optional(),
});

/** Inspection with an optional photo, sent as a form. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("recordInspection");
  const f = await req.formData();
  const get = (k: string) => { const v = f.get(k); return typeof v === "string" && v !== "" ? v : undefined; };
  const d = schema.parse({ inspectedOn: get("inspectedOn"), rating: get("rating"), finding: get("finding"), analysisId: get("analysisId"), overrideReason: get("overrideReason") });
  const file = f.get("photo");
  let photo;
  if (file instanceof File && file.size > 0) {
    if (!IMAGE_TYPES.includes(file.type as any)) throw new HttpError(422, "The photo must be a JPEG, PNG or WebP image", "validation");
    if (file.size > 4 * 1024 * 1024) throw new HttpError(413, "The photo is larger than 4 MB", "too_large");
    photo = { contentType: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
  }
  return recordInspectionFull(u.id, { positionId: id, ...d, photo });
});

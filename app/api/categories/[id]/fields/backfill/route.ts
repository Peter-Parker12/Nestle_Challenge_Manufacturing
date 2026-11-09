import { route } from "@/lib/api";
import { HttpError, requireRole } from "@/lib/auth";
import { backfill } from "@/lib/fields";

export const maxDuration = 120;

/** Multipart: file, dryRun ("true" to check only). Writes values for existing products. All or nothing. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("backfillFields");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(422, "Attach a CSV file", "validation");
  if (file.size > 5 * 1024 * 1024) throw new HttpError(413, "File is larger than 5 MB", "too_large");
  return backfill(u.id, { categoryId: id, text: await file.text(), dryRun: form.get("dryRun") !== "false" });
});

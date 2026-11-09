import { route } from "@/lib/api";
import { HttpError, requireRole } from "@/lib/auth";
import { validateUpload } from "@/lib/importRepo";

export const POST = route(async (req) => {
  const u = await requireRole("importHistory");
  const form = await req.formData();
  const file = form.get("file");
  const categoryId = String(form.get("categoryId") ?? "");
  if (!(file instanceof File)) throw new HttpError(422, "Attach a CSV file", "validation");
  if (!/^[0-9a-f-]{36}$/.test(categoryId)) throw new HttpError(422, "Choose a category", "validation");
  if (file.size > 5 * 1024 * 1024) throw new HttpError(413, "File is larger than 5 MB", "too_large");
  return validateUpload(u.id, { filename: file.name.slice(0, 200), text: await file.text(), categoryId, assumeAccepted: form.get("assumeAccepted") === "true" });
});

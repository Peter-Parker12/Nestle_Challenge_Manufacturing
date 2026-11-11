import { route } from "@/lib/api";
import { HttpError, requireRole } from "@/lib/auth";
import { analyseSealPhoto } from "@/lib/ai/vision";

export const POST = route(async (req) => {
  const u = await requireRole("recordInspection");
  const file = (await req.formData()).get("photo");
  if (!(file instanceof File)) throw new HttpError(422, "Attach a photo", "validation");
  return analyseSealPhoto(u.id, { contentType: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
});

import { route } from "@/lib/api";
import { HttpError, requireRole } from "@/lib/auth";
import { createPhoto, listPhotos } from "@/lib/radar";
export const dynamic = "force-dynamic";
export const GET = route(async () => ({ photos: await listPhotos() }));
export const POST = route(async (req) => {
  const u = await requireRole("uploadPhoto");
  const f = await req.formData();
  const file = f.get("file");
  if (!(file instanceof Blob)) throw new HttpError(422, "Attach a photo", "validation");
  const retailerId = String(f.get("retailerId") ?? ""), takenOn = String(f.get("takenOn") ?? new Date().toISOString().slice(0, 10));
  if (!/^[0-9a-f-]{36}$/.test(retailerId)) throw new HttpError(422, "Choose the store", "validation");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) throw new HttpError(422, "The date must be YYYY-MM-DD", "validation");
  const id = await createPhoto(u.id, { retailerId, takenOn, bytes: Buffer.from(await file.arrayBuffer()), mime: file.type });
  return { id };
});

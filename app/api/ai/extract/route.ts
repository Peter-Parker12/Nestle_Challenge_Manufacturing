import { extractReport } from "@/lib/ai/features";
import { route } from "@/lib/api";
import { HttpError, requireRole } from "@/lib/auth";

export const maxDuration = 120;

export const POST = route(async (req) => {
  const u = await requireRole("extraction");
  const form = await req.formData();
  const file = form.get("file");
  const launchId = String(form.get("launchId") ?? "");
  if (!(file instanceof File)) throw new HttpError(422, "Attach a file", "validation");
  if (!/^[0-9a-f-]{36}$/.test(launchId)) throw new HttpError(422, "launchId is required", "validation");
  return extractReport({ name: file.name, mime: file.type || "text/plain", bytes: Buffer.from(await file.arrayBuffer()) }, launchId, u.id);
});

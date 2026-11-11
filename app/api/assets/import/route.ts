import { route } from "@/lib/api";
import { HttpError, requireRole } from "@/lib/auth";
import { assetTemplate, checkAssetCsv, commitAssetCsv, exportAssetCsv } from "@/lib/assetImport";

export const dynamic = "force-dynamic";

const csv = (text: string, name: string) => new Response(text, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });

export const GET = route(async (req) => {
  await requireRole("importAssets");
  const u = new URL(req.url);
  if (u.searchParams.get("export")) return csv(await exportAssetCsv(), "seal-history.csv");
  return csv(assetTemplate(), "seal-history-template.csv");
});

export const POST = route(async (req) => {
  const u = await requireRole("importAssets");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(422, "Attach a CSV file", "validation");
  if (file.size > 5 * 1024 * 1024) throw new HttpError(413, "File is larger than 5 MB", "too_large");
  const text = await file.text();
  if (form.get("commit") === "true") return { committed: await commitAssetCsv(u.id, text) };
  return { check: (await checkAssetCsv(text)).check };
});

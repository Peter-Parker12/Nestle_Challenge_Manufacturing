import { route } from "@/lib/api";
import { HttpError, requireRole } from "@/lib/auth";
import { exportHistory } from "@/lib/importRepo";

export const dynamic = "force-dynamic";

/** Download the history of a category in the import format. Restricted like the import, since recipes are sensitive. */
export const GET = route(async (req) => {
  await requireRole("importHistory");
  const id = new URL(req.url).searchParams.get("categoryId");
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(422, "categoryId is required", "validation");
  const csv = await exportHistory(id);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="history-export-${new Date().toISOString().slice(0, 10)}.csv"` } });
});

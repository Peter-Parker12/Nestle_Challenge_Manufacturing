import { route } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { templateFor } from "@/lib/importRepo";

export const dynamic = "force-dynamic";

/** CSV template for a category: columns are generated from its attributes, parameters and quality tests. */
export const GET = route(async (req) => {
  const id = new URL(req.url).searchParams.get("categoryId");
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(422, "categoryId is required", "validation");
  const t = await templateFor(id);
  return new Response(t.csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="history-template-${t.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv"` },
  });
});

import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { backfillTemplate } from "@/lib/fields";

export const dynamic = "force-dynamic";

/** A CSV of every product in the category with its current field values, ready to fill in. */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  await requireRole("backfillFields");
  return new Response(await backfillTemplate(id), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="product-fields-backfill.csv"' } });
});

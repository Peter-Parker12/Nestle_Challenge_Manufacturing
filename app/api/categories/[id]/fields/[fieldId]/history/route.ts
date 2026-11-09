import { route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { fieldHistory } from "@/lib/fields";

export const dynamic = "force-dynamic";

/** What changed on a field's definition, when, by whom and why. Same audience as the audit log. */
export const GET = route<{ id: string; fieldId: string }>(async (_req, { fieldId }) => {
  await requireRole("viewAudit");
  return { events: await fieldHistory(fieldId) };
});

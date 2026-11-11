import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { STOP_KINDS, createStop, listStops, setStopStatus } from "@/lib/assets";

export const dynamic = "force-dynamic";
export const GET = route(async () => ({ stops: await listStops() }));

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), lineId: z.string().uuid(), startOn: date, endOn: date, kind: z.enum(STOP_KINDS), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("status"), id: z.string().uuid(), status: z.enum(["Done", "Cancelled"]) }),
]);
export const POST = route(async (req) => {
  const u = await requireRole("manageStops");
  const d = await body(req, schema);
  return d.action === "create" ? createStop(u.id, d) : setStopStatus(u.id, d.id, d.status);
});

import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { commitLoad } from "@/lib/importRepo";

export const maxDuration = 300;

export const POST = route<{ id: string }>(async (req, { id }) => {
  const u = await requireRole("importHistory");
  const d = await body(req, z.object({ skipInvalid: z.boolean().default(false) }).default({ skipInvalid: false }));
  return commitLoad(u.id, id, { skipInvalid: d.skipInvalid });
});

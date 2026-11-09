import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { createLaunch, listCategories, listLaunches, listLines } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = route(async () => ({ launches: await listLaunches(), categories: await listCategories(), lines: await listLines() }));

const schema = z.object({
  categoryId: z.string().uuid(),
  lineId: z.string().uuid(),
  name: z.string().min(1).max(120),
  code: z.string().max(40).optional(),
  objective: z.string().max(500).optional(),
  attrs: z.record(z.string(), z.union([z.number(), z.string()])),
  specs: z.record(z.string(), z.object({ min: z.number().nullable(), max: z.number().nullable() })).default({}),
});

export const POST = route(async (req) => {
  const u = await requireRole("createLaunch");
  const d = await body(req, schema);
  return createLaunch(u.id, d);
});

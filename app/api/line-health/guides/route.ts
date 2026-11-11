import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { createGuide, getGuide, listGuides } from "@/lib/linehealth";

export const dynamic = "force-dynamic";
export const GET = route(async (req) => {
  const code = new URL(req.url).searchParams.get("code");
  return code ? { guide: await getGuide(code) } : { guides: await listGuides() };
});
const list = z.array(z.string().min(1).max(60)).max(20);
export const POST = route(async (req) => {
  const u = await requireRole("manageGuides");
  const d = await body(req, z.object({ code: z.string(), title: z.string().min(3).max(120), alarmCodes: list, keywords: list, steps: z.array(z.string().max(400)).max(30), source: z.string().max(120).optional() }));
  return createGuide(u.id, d);
});

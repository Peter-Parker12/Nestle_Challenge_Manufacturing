import { z } from "zod";
import { generateBrief, getBrief, listBriefs } from "@/lib/ai/brief";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const GET = route(async () => ({ briefs: await listBriefs(), latest: await getBrief() }));
export const POST = route(async (req) => { const u = await requireRole("refresh"); const { language } = await body(req, z.object({ language: z.enum(["en", "vi"]).default("en") })); return generateBrief(u.id, language); });

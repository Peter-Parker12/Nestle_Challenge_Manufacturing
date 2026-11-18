import { z } from "zod";
import { body, route } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getSettingRows, saveSetting } from "@/lib/radar";
export const dynamic = "force-dynamic";
export const GET = route(async () => ({ settings: await getSettingRows() }));
export const POST = route(async (req) => { const u = await requireRole("manageSettings"); const d = await body(req, z.object({ key: z.string().max(60), value: z.number(), reason: z.string().max(300) })); await saveSetting(u.id, d.key, d.value, d.reason); return { ok: true }; });

import { getBrief } from "@/lib/ai/brief";
import { route } from "@/lib/api";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>(async (_req, { id }) => getBrief(id));

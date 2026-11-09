import { route } from "@/lib/api";
import { getLaunchDetail } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>(async (_req, { id }) => getLaunchDetail(id));

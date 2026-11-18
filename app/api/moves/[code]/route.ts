import { route } from "@/lib/api";
import { getMove } from "@/lib/radar";
export const dynamic = "force-dynamic";
export const GET = route<{ code: string }>(async (_req, { code }) => getMove(code));

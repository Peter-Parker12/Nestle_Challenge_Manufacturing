import { route } from "@/lib/api";
import { listMoves } from "@/lib/radar";
export const dynamic = "force-dynamic";
export const GET = route(async (req) => { const u = new URL(req.url); return { moves: await listMoves({ channel: u.searchParams.get("channel") ?? undefined }) }; });

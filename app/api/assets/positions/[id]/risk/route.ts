import { route } from "@/lib/api";
import { positionRisk } from "@/lib/risk";

export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>(async (_r, { id }) => ({ risk: await positionRisk(id) }));

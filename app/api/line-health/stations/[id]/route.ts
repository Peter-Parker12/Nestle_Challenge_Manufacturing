import { route } from "@/lib/api";
import { stationDetail } from "@/lib/linehealth";

export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>(async (_r, { id }) => stationDetail(id));

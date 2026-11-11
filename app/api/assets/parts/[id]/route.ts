import { route } from "@/lib/api";
import { getPart } from "@/lib/assets";

export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>(async (_r, { id }) => getPart(id));

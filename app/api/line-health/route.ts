import { route } from "@/lib/api";
import { fillerHealth, listFillers } from "@/lib/linehealth";

export const dynamic = "force-dynamic";
export const GET = route(async (req) => {
  const fillers = await listFillers();
  const id = new URL(req.url).searchParams.get("filler") ?? fillers[0]?.id;
  return { fillers, health: id ? await fillerHealth(id) : null };
});

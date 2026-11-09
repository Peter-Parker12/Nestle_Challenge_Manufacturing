import { aiEnabled, models } from "@/lib/ai/client";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const GET = route(async () => ({ enabled: aiEnabled(), models: { main: models.main(), fast: models.fast() } }));

import { route } from "@/lib/api";
import { plantOverview } from "@/lib/assets";

export const dynamic = "force-dynamic";
export const GET = route(async () => plantOverview());

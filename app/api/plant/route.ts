import { route } from "@/lib/api";
import { plantStatus } from "@/lib/plant";

export const dynamic = "force-dynamic";
export const GET = route(async () => plantStatus());

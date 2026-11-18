import { route } from "@/lib/api";
import { setupLists } from "@/lib/radar";
export const dynamic = "force-dynamic";
export const GET = route(async () => setupLists());

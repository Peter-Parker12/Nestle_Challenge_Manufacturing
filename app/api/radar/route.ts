import { route } from "@/lib/api";
import { overview } from "@/lib/radar";
export const dynamic = "force-dynamic";
export const GET = route(async () => overview());

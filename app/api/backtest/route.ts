import { route } from "@/lib/api";
import { backtest } from "@/lib/radar";
export const dynamic = "force-dynamic";
export const GET = route(async () => backtest());

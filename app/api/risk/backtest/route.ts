import { route } from "@/lib/api";
import { backtest } from "@/lib/risk";

export const dynamic = "force-dynamic";
export const GET = route(async () => backtest(30));

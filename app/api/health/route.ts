import { NextResponse } from "next/server";
import { aiEnabled } from "@/lib/ai/client";
import { q1 } from "@/lib/db";
import { ENGINE_VERSION } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await q1("select 1");
    return NextResponse.json({ status: "ok", db: true, ai: aiEnabled(), engine: ENGINE_VERSION, time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "degraded", db: false, ai: aiEnabled(), engine: ENGINE_VERSION }, { status: 503 });
  }
}

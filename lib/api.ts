import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { HttpError } from "./auth";
import { AiUnavailable } from "./ai/client";

type Ctx<P> = { params: Promise<P> };

/** Wrap a route handler: consistent JSON errors, database rule violations surfaced as 409/422, no stack traces to clients. */
export function route<P = Record<string, string>>(fn: (req: Request, params: P) => Promise<unknown>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const out = await fn(req, await ctx.params);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e: any) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
      if (e instanceof AiUnavailable) return NextResponse.json({ error: "ai_unavailable", message: e.message }, { status: 503 });
      if (e instanceof ZodError) return NextResponse.json({ error: "validation", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 422 });
      // PostgreSQL: P0001 = raise exception from our business-rule triggers; 23xxx = constraint violations
      if (e?.code === "P0001") return NextResponse.json({ error: "rule_violation", message: e.message }, { status: 409 });
      if (typeof e?.code === "string" && e.code.startsWith("23")) return NextResponse.json({ error: "constraint", message: e.detail || e.message }, { status: 422 });
      if (e?.status === 429) return NextResponse.json({ error: "ai_rate_limited", message: "The AI service is busy. Try again shortly." }, { status: 429 });
      if (typeof e?.status === "number" && e?.name?.includes("Anthropic")) return NextResponse.json({ error: "ai_error", message: "The AI service returned an error." }, { status: 502 });
      console.error("[api] unhandled", e);
      return NextResponse.json({ error: "internal", message: "Unexpected server error" }, { status: 500 });
    }
  };
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON", "bad_json");
  }
  return schema.parse(json);
}

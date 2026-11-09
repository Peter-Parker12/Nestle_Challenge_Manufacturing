import { NextResponse } from "next/server";
import { z } from "zod";
import { body, route } from "@/lib/api";
import { HttpError, getUser } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { listUsers } from "@/lib/repo";

export const dynamic = "force-dynamic";
const switcher = () => process.env.DEMO_USER_SWITCHER !== "false";

export const GET = route(async () => {
  return { user: await getUser(), users: switcher() ? await listUsers() : [], switcher: switcher() };
});

export const POST = route(async (req) => {
  if (!switcher()) throw new HttpError(403, "The user switcher is disabled", "forbidden");
  const { userId } = await body(req, z.object({ userId: z.string().uuid() }));
  const u = await q1("select id from cfg.app_user where id=$1 and active", [userId]);
  if (!u) throw new HttpError(404, "User not found", "not_found");
  const res = NextResponse.json({ ok: true });
  const https = req.headers.get("x-forwarded-proto") === "https";
  res.cookies.set("baf1_user", userId, { httpOnly: true, sameSite: "lax", secure: https, path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { body, route } from "@/lib/api";
import { HttpError, getUser } from "@/lib/auth";
import { q, q1 } from "@/lib/db";

export const dynamic = "force-dynamic";
const switcher = () => process.env.DEMO_USER_SWITCHER !== "false";
const users = () => q("select id, name, role from cfg.app_user where active order by name");

export const GET = route(async () => ({ user: await getUser(), users: switcher() ? await users() : [], switcher: switcher() }));
export const POST = route(async (req) => {
  if (!switcher()) throw new HttpError(403, "The user switcher is disabled", "forbidden");
  const { userId } = await body(req, z.object({ userId: z.string().uuid() }));
  if (!(await q1("select id from cfg.app_user where id=$1 and active", [userId]))) throw new HttpError(404, "User not found", "not_found");
  const res = NextResponse.json({ ok: true });
  res.cookies.set("radar_user", userId, { httpOnly: true, sameSite: "lax", secure: req.headers.get("x-forwarded-proto") === "https", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
});

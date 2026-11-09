import { cookies } from "next/headers";
import { q1 } from "./db";
import { PERMISSIONS, type Role } from "./permissions";

export { PERMISSIONS };
export type { Role };

/**
 * DEMO AUTH STUB. The app trusts a cookie holding a user id so reviewers can switch roles.
 * In production, replace getUser() with SSO claims (for example Azure AD) and keep the role checks.
 * Set DEMO_USER_SWITCHER=false to disable the switcher endpoint.
 */
export type User = { id: string; name: string; role: Role };

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}


export async function getUser(): Promise<User> {
  const jar = await cookies();
  const id = jar.get("baf1_user")?.value;
  let u = id ? await q1<User>("select id, name, role from cfg.app_user where id=$1 and active", [id]) : null;
  if (!u) u = await q1<User>("select id, name, role from cfg.app_user where role='rd_engineer' and active order by name limit 1");
  if (!u) throw new HttpError(401, "No users configured. Run the seed.", "no_user");
  return u;
}

export async function requireRole(action: keyof typeof PERMISSIONS): Promise<User> {
  const u = await getUser();
  if (!(PERMISSIONS[action] as Role[]).includes(u.role))
    throw new HttpError(403, `Role '${u.role}' is not allowed to do this (${action}).`, "forbidden");
  return u;
}

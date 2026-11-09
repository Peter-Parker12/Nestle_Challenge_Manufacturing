import { createHash, timingSafeEqual } from "node:crypto";
import { q1 } from "../db";
import type { Role } from "../permissions";

/**
 * Access control for the MCP endpoint that Microsoft Copilot (or any MCP client) connects to.
 *  - Off unless MCP_API_KEY is set.
 *  - The key goes in `Authorization: Bearer <key>` or `x-api-key: <key>`.
 *  - Calls run as one service account ("Copilot (MCP)") with a fixed role, so the audit log shows who acted.
 *    The account is inactive, so it never appears in the demo role switcher and cannot sign in to the web app.
 *  - A simple per-key rate limit protects the AI endpoints behind it.
 */
export const mcpEnabled = () => !!process.env.MCP_API_KEY && process.env.MCP_API_KEY.length >= 16;

const SERVICE_ROLES: Role[] = ["viewer", "rd_engineer", "process_engineer"];
export function serviceRole(): Role {
  const r = (process.env.MCP_SERVICE_ROLE ?? "rd_engineer") as Role;
  return SERVICE_ROLES.includes(r) ? r : "rd_engineer";
}

const digest = (s: string) => createHash("sha256").update(s).digest();
function keyMatches(given: string): boolean {
  const expected = process.env.MCP_API_KEY ?? "";
  return !!expected && timingSafeEqual(digest(given), digest(expected));
}

function presentedKey(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h && /^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, "").trim();
  return req.headers.get("x-api-key")?.trim() || null;
}

const hits = new Map<string, { n: number; reset: number }>();
function limited(id: string): boolean {
  const max = Number(process.env.MCP_RATE_LIMIT_PER_MIN ?? 60);
  const now = Date.now();
  const h = hits.get(id);
  if (!h || h.reset < now) { hits.set(id, { n: 1, reset: now + 60_000 }); return false; }
  h.n++;
  return h.n > max;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export function authenticate(req: Request): { ok: true } | { ok: false; response: Response } {
  if (!mcpEnabled()) return { ok: false, response: json(503, { error: "mcp_disabled", message: "The MCP endpoint is not enabled on this server (MCP_API_KEY is not set)." }) };
  const given = presentedKey(req);
  if (!given || !keyMatches(given)) return { ok: false, response: json(401, { error: "unauthorized", message: "A valid API key is required." }, { "www-authenticate": 'Bearer realm="launch-accelerator-mcp"' }) };
  if (limited(createHash("sha256").update(given).digest("hex").slice(0, 16))) return { ok: false, response: json(429, { error: "rate_limited", message: "Too many requests. Try again in a minute." }, { "retry-after": "60" }) };
  return { ok: true };
}

let cached: { role: Role; id: string } | null = null;
/** The service account that Copilot acts as. Created on first use; its role follows MCP_SERVICE_ROLE. */
export async function serviceUser(): Promise<{ id: string; role: Role }> {
  const role = serviceRole();
  if (cached && cached.role === role) return cached;
  const r = await q1<{ id: string }>(
    `insert into cfg.app_user(name,email,role,active) values ('Copilot (MCP)','copilot@service.local',$1,false)
     on conflict (email) do update set role=excluded.role, active=false returning id`, [role]);
  cached = { role, id: r!.id };
  return cached;
}

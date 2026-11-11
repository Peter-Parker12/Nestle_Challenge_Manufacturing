import { route } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { q1 } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>(async (_r, { id }) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "Not found", "not_found");
  const p = await q1<{ content_type: string; data: Buffer }>("select content_type, data from ast.inspection_photo where inspection_id=$1", [id]);
  if (!p) throw new HttpError(404, "No photo", "not_found");
  return new Response(new Uint8Array(p.data), { headers: { "content-type": p.content_type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
});

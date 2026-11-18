import { photoBytes } from "@/lib/radar";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  try { const p = await photoBytes(id); return new Response(new Uint8Array(p.bytes), { headers: { "content-type": p.mime, "cache-control": "private, max-age=3600" } }); }
  catch { return new Response("Not found", { status: 404 }); }
}

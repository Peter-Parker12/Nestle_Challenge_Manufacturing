import Link from "next/link";
import { PhotoTools, ReadButton, Readings } from "@/components/ShelfWorkbench";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getPhoto, listPhotos } from "@/lib/radar";
import { aiEnabled } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export default async function Shelf({ searchParams }: { searchParams: Promise<{ photo?: string }> }) {
  const sp = await searchParams;
  const user = await getUser();
  const photos = await listPhotos();
  const stores = await q(`select r.id, r.name from mkt.retailer r join cfg.channel c on c.id=r.channel_id where c.code='GT' order by r.code`);
  const sel = photos.find((p) => p.id === sp.photo) ?? photos[0];
  const detail = sel ? await getPhoto(sel.id) : null;
  return (
    <>
      <div className="eyebrow">Sales · shelf prices</div>
      <h1>Shelf photos</h1>
      <p className="sub">Claude reads the price tags and facings in a photo. A person confirms each reading before it enters the price history, and the AI value and the person&apos;s value are both kept.</p>
      <PhotoTools stores={stores as any} canUpload={can(user.role, "uploadPhoto")} />
      <div className="grid" style={{ gridTemplateColumns: "minmax(200px, 260px) minmax(0, 1fr)", alignItems: "start", marginTop: 14 }}>
        <section className="card">
          <h2>Photos</h2>
          {photos.length === 0 && <p className="muted">No photos yet.</p>}
          <div style={{ display: "grid", gap: 8 }}>
            {photos.map((p) => (
              <Link key={p.id} href={`/shelf?photo=${p.id}`} className="asm" style={{ borderColor: p.id === sel?.id ? "var(--link)" : undefined, color: "inherit", textDecoration: "none" }}>
                <strong>{p.retailer}</strong><div className="small muted">{p.taken_on}{p.is_mock && " · MOCK"}</div>
                <div className="small">{p.items === 0 ? <span className="badge b-gray">Not read</span> : p.pending > 0 ? <span className="badge b-amber">{p.pending} to check</span> : <span className="badge b-green">All checked</span>}</div>
              </Link>
            ))}
          </div>
        </section>
        {detail ? (
          <section className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{detail.photo.retailer} · {detail.photo.taken_on}</h2>
              {detail.photo.is_mock && <span className="badge b-amber">Mock shelf image, generated for the demo</span>}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/photos/${detail.photo.id}/image`} alt={`Shelf photo from ${detail.photo.retailer}`} style={{ width: "100%", maxWidth: 760, borderRadius: 12, border: "1px solid var(--line)", margin: "12px 0" }} />
            {detail.items.length === 0
              ? <><p className="muted">This photo has not been read yet.</p><ReadButton photoId={detail.photo.id} allowed={can(user.role, "uploadPhoto") && aiEnabled()} />{!aiEnabled() && <div className="msg info">Reading needs the Claude API key (ANTHROPIC_API_KEY). The rest of the radar works without it.</div>}</>
              : <Readings items={detail.items as any} canCheck={can(user.role, "checkReading")} />}
            <div className="small muted" style={{ marginTop: 10 }}>Photos are stored with their hash and cannot be changed. The AI call log keeps only the hash, not the image.</div>
          </section>
        ) : <section className="card"><p className="muted">Add a photo to begin.</p></section>}
      </div>
    </>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

type Item = { id: string; idx: number; label: string; sku_name: string | null; sku_code: string | null; ai_price: number | null; ai_facings: number | null; ai_conf: number; ai_note: string | null; needs_check: boolean; status: string; human_price: number | null; reason: string | null; checked_by_name: string | null };

export function PhotoTools({ stores, canUpload }: { stores: { id: string; name: string }[]; canUpload: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [store, setStore] = useState(stores[0]?.id ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  async function mock() {
    setBusy(true); setMsg(null);
    const r = await api("/api/photos/mock", { method: "POST" });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message ?? "Failed" });
    router.push(`/shelf?photo=${r.data.id}`); router.refresh();
  }
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const form = new FormData(e.currentTarget);
    form.set("retailerId", store); form.set("takenOn", date);
    const r = await api("/api/photos", { form });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message ?? "Failed" });
    router.push(`/shelf?photo=${r.data.id}`); router.refresh();
  }
  return (
    <section className="card">
      <h2>Add a photo</h2>
      {!canUpload && <p className="muted">Your role cannot add photos.</p>}
      <form onSubmit={upload} className="form-grid" style={{ maxWidth: 760 }}>
        <div className="field"><label htmlFor="store">Store</label><select id="store" value={store} onChange={(e) => setStore(e.target.value)} disabled={!canUpload}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label htmlFor="date">Taken on</label><input id="date" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} disabled={!canUpload} /></div>
        <div className="field"><label htmlFor="file">Photo (PNG or JPEG, up to 5 MB)</label><input id="file" name="file" type="file" accept="image/png,image/jpeg" required disabled={!canUpload} /></div>
        <div className="row" style={{ alignItems: "end" }}><button disabled={busy || !canUpload}>Upload</button><button type="button" className="ghost" disabled={busy || !canUpload} onClick={mock}>Generate a mock photo</button></div>
      </form>
      <div className="small muted" style={{ marginTop: 8 }}>A mock photo is a drawn shelf with price tags, one of them partly covered. It is labelled MOCK in the image and in the database.</div>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role="alert">{msg.text}</div>}
    </section>
  );
}

export function ReadButton({ photoId, allowed }: { photoId: string; allowed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    const r = await api(`/api/photos/${photoId}/read`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return setMsg(r.error === "ai_unavailable" ? "Reading needs the Claude API. No API key is configured on the server." : r.message ?? "Failed");
    if (!r.data.usable) setMsg(`The photo could not be read: ${r.data.notes ?? "too blurred or small"}.`);
    router.refresh();
  }
  return <div><button disabled={busy || !allowed} onClick={go}>{busy ? "Reading…" : "Read with Claude"}</button>{msg && <div className="msg warn" role="alert">{msg}</div>}</div>;
}

export function Readings({ items, canCheck }: { items: Item[]; canCheck: boolean }) {
  const router = useRouter();
  const [price, setPrice] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = items.filter((i) => i.status !== "Pending").length;

  async function act(it: Item, action: "confirm" | "correct" | "unreadable") {
    setBusy(true); setErr(null);
    const body: any = { action };
    if (action === "correct") { body.price = Number(String(price[it.id] ?? "").replace(/[,\s]/g, "")); body.reason = why[it.id]; }
    if (action === "unreadable") body.reason = why[it.id] || undefined;
    const r = await api(`/api/photo-items/${it.id}`, { body });
    setBusy(false);
    if (!r.ok) return setErr(r.message ?? "Failed");
    setOpen(null); router.refresh();
  }
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>What Claude read</h2><span className="small muted">{done} of {items.length} checked</span></div>
      <div className="tw"><table>
        <thead><tr><th>#</th><th>Item</th><th>Price read</th><th>Facings</th><th>Confidence</th><th>Your check</th></tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td><strong>{it.idx + 1}</strong></td>
              <td>{it.sku_name ?? it.label}<div className="small muted">{it.ai_note}{!it.sku_code && " · not a tracked product"}</div></td>
              <td><strong>{it.status === "Corrected" ? <>{it.human_price?.toLocaleString("en-US")} <span className="small muted">(AI: {it.ai_price?.toLocaleString("en-US") ?? "none"})</span></> : it.ai_price != null ? it.ai_price.toLocaleString("en-US") : <span className="muted">not read</span>}</strong></td>
              <td>{it.ai_facings ?? "–"}</td>
              <td><span className={`badge ${it.needs_check ? "b-amber" : "b-green"}`}>{Math.round(it.ai_conf * 100)}%</span></td>
              <td>
                {it.status !== "Pending" ? <span className={`badge ${it.status === "Unreadable" ? "b-gray" : "b-green"}`}>{it.status}{it.checked_by_name ? ` · ${it.checked_by_name.split(" (")[0]}` : ""}</span> : open === it.id ? (
                  <div style={{ display: "grid", gap: 6, minWidth: 220 }}>
                    <label htmlFor={`p${it.id}`}>Price (VND)</label><input id={`p${it.id}`} inputMode="numeric" value={price[it.id] ?? ""} onChange={(e) => setPrice({ ...price, [it.id]: e.target.value })} placeholder="28,000" />
                    <label htmlFor={`w${it.id}`}>Why (needed to correct)</label><input id={`w${it.id}`} value={why[it.id] ?? ""} onChange={(e) => setWhy({ ...why, [it.id]: e.target.value })} placeholder="Read from the photo" />
                    <div className="row"><button className="small" disabled={busy} onClick={() => act(it, "correct")}>Save price</button><button className="small ghost" disabled={busy} onClick={() => act(it, "unreadable")}>Unreadable</button><button className="small ghost" onClick={() => setOpen(null)}>Cancel</button></div>
                  </div>
                ) : (
                  <div className="row">
                    {it.ai_price != null && it.sku_code && <button className="small" disabled={!canCheck || busy} onClick={() => act(it, "confirm")}>Confirm</button>}
                    <button className="small ghost" disabled={!canCheck || busy} onClick={() => setOpen(it.id)}>{it.needs_check ? "Check price" : "Correct"}</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {items.some((i) => i.needs_check && i.status === "Pending") && <div className="msg warn">Readings marked amber need you: a tag that is covered or unclear is not guessed, and a price far from the usual range is held for a check.</div>}
      {err && <div className="msg err" role="alert">{err}</div>}
      <div className="small muted" style={{ marginTop: 10 }}>Rule in the database: a confirmed or corrected reading adds a price observation; the AI reading stays beside it and is never overwritten. Changing a price needs a reason. Rows are never edited or deleted.</div>
    </div>
  );
}

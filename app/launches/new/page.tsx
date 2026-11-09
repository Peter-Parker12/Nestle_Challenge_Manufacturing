"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/components/api";

type Attr = { code: string; name: string; unit: string | null; type: "numeric" | "choice"; choices?: string[]; required: boolean; absMin: number | null; absMax: number | null };
type Test = { code: string; name: string; unit: string | null; is_critical: boolean };

export default function NewLaunch() {
  const router = useRouter();
  const [cats, setCats] = useState<{ id: string; code: string; name: string }[]>([]);
  const [lines, setLines] = useState<{ id: string; code: string; name: string }[]>([]);
  const [catId, setCatId] = useState("");
  const [lineId, setLineId] = useState("");
  const [attrDefs, setAttrDefs] = useState<Attr[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [specs, setSpecs] = useState<Record<string, { min: string; max: string }>>({});
  const [text, setText] = useState("");
  const [aiOn, setAiOn] = useState(false);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [l, s] = await Promise.all([api("/api/launches"), api("/api/ai/status")]);
      if (l.ok) {
        setCats(l.data.categories);
        setLines(l.data.lines);
        setCatId(l.data.categories.find((c: any) => c.code === "UHT_DRINK")?.id ?? l.data.categories[0]?.id ?? "");
        setLineId(l.data.lines[0]?.id ?? "");
      }
      setAiOn(!!s.data?.enabled);
    })();
  }, []);
  useEffect(() => {
    if (!catId) return;
    (async () => {
      const r = await api(`/api/categories/${catId}/config`);
      if (r.ok) { setAttrDefs(r.data.attrDefs); setTests(r.data.tests); setAttrs({}); setSpecs({}); }
    })();
  }, [catId]);

  async function fillFromText() {
    setBusy(true); setMsg(null);
    const r = await api("/api/ai/parse-request", { body: { text, categoryId: catId } });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.error === "ai_unavailable" ? "AI is not configured on this server (no API key). Fill the form by hand." : r.message ?? "Failed" });
    if (r.data.productName) setName(r.data.productName);
    setAttrs((a) => ({ ...a, ...Object.fromEntries(Object.entries(r.data.attrs).map(([k, v]) => [k, String(v)])) }));
    const notes = [...r.data.warnings, ...(r.data.unparsed.length ? [`Not matched to any field: ${r.data.unparsed.join("; ")}`] : [])];
    setMsg({ kind: notes.length ? "warn" : "info", text: "Fields filled from your description. Check every value before saving." + (notes.length ? " " + notes.join(". ") : "") });
  }

  async function save() {
    setBusy(true); setMsg(null);
    const a: Record<string, string | number> = {};
    for (const d of attrDefs) {
      const v = attrs[d.code];
      if (v === undefined || v === "") continue;
      a[d.code] = d.type === "numeric" ? Number(v) : v;
    }
    const s: Record<string, { min: number | null; max: number | null }> = {};
    for (const [k, v] of Object.entries(specs)) if (v.min !== "" || v.max !== "") s[k] = { min: v.min === "" ? null : Number(v.min), max: v.max === "" ? null : Number(v.max) };
    const r = await api("/api/launches", { body: { categoryId: catId, lineId, name, objective: objective || undefined, attrs: a, specs: s } });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Failed" });
    router.push(`/launches/${r.data.id}`);
  }

  return (
    <>
      <h1>New launch</h1>
      <p className="sub">Describe the product and its quality targets. The next step produces a recommended starting window from similar past launches.</p>

      <div className="card">
        <h2>Describe it in words (optional)</h2>
        <label htmlFor="nl">For example: “New chocolate malt RTD, 200 ml carton, cocoa base, around 2.8% fat, 15% solids, viscosity about 38 cP.”</label>
        <textarea id="nl" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="ghost" disabled={busy || !text.trim() || !aiOn} onClick={fillFromText}>Fill the form with Claude</button>
          {!aiOn && <span className="small muted">Needs an Anthropic API key on the server.</span>}
        </div>
      </div>

      <div className="card">
        <h2>Product</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="cat">Category</label>
            <select id="cat" value={catId} onChange={(e) => setCatId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="field"><label htmlFor="line">Line</label>
            <select id="line" value={lineId} onChange={(e) => setLineId(e.target.value)}>{lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div className="field"><label htmlFor="nm">Product name</label><input id="nm" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="ob">Objective</label><input id="ob" value={objective} onChange={(e) => setObjective(e.target.value)} /></div>
        </div>
        <h3>Attributes</h3>
        <div className="form-grid">
          {attrDefs.map((d) => (
            <div className="field" key={d.code}>
              <label htmlFor={`a-${d.code}`}>{d.name}{d.unit ? ` (${d.unit})` : ""}{d.required ? " *" : ""}</label>
              {d.type === "choice" ? (
                <select id={`a-${d.code}`} value={attrs[d.code] ?? ""} onChange={(e) => setAttrs({ ...attrs, [d.code]: e.target.value })}>
                  <option value="">Select…</option>{d.choices?.map((c) => <option key={c}>{c}</option>)}
                </select>
              ) : (
                <input id={`a-${d.code}`} type="number" step="any" min={d.absMin ?? undefined} max={d.absMax ?? undefined} value={attrs[d.code] ?? ""} onChange={(e) => setAttrs({ ...attrs, [d.code]: e.target.value })} />
              )}
              {d.type === "numeric" && d.absMin !== null && <div className="small muted">Allowed {d.absMin} to {d.absMax}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Quality targets</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Leave a limit empty if it does not apply. Critical tests decide whether a run fails.</p>
        <div className="form-grid">
          {tests.map((t) => (
            <div className="field" key={t.code}>
              <label>{t.name}{t.unit ? ` (${t.unit})` : ""} {t.is_critical && <span className="badge b-amber">critical</span>}</label>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input aria-label={`${t.name} minimum`} placeholder="min" type="number" step="any" value={specs[t.code]?.min ?? ""} onChange={(e) => setSpecs({ ...specs, [t.code]: { min: e.target.value, max: specs[t.code]?.max ?? "" } })} />
                <input aria-label={`${t.name} maximum`} placeholder="max" type="number" step="any" value={specs[t.code]?.max ?? ""} onChange={(e) => setSpecs({ ...specs, [t.code]: { min: specs[t.code]?.min ?? "", max: e.target.value } })} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      <button disabled={busy || !name.trim() || !catId || !lineId} onClick={save}>Create launch</button>
    </>
  );
}

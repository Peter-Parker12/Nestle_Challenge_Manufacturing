"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import { can, type Role } from "@/lib/permissions";

type Msg = { kind: "ok" | "err"; text: string } | null;
const KINDS = ["filler", "homogeniser", "uht", "valve_cluster", "pump", "tank", "other"];

export default function AssetSetup({ role, lines, equipment, partTypes }: { role: Role; lines: any[]; equipment: any[]; partTypes: any[] }) {
  const router = useRouter();
  const allowed = can(role, "manageAssets");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [e, setE] = useState({ lineId: lines[0]?.id ?? "", code: "", name: "", kind: "filler" });
  const [p, setP] = useState({ equipmentId: equipment[0]?.id ?? "", code: "", name: "", assembly: "", sealFunction: "", criticality: "3" });
  const [t, setT] = useState({ code: "", name: "", material: "", supplier: "", nominalLifeDays: "180" });

  async function send(body: Record<string, unknown>, ok: string, reset: () => void) {
    setBusy(true); setMsg(null);
    const r = await api("/api/assets/setup", { body });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message ?? "Failed" });
    setMsg({ kind: "ok", text: ok }); reset(); router.refresh();
  }
  return (
    <>
      {!allowed && <div className="msg info">You can see the setup. Only plant admins and maintenance change it.</div>}
      {msg && <div className={`msg ${msg.kind}`} role="status">{msg.text}</div>}
      <div className="grid g2">
        <div className="card">
          <h2>Equipment</h2>
          <div className="tw"><table><thead><tr><th>Line</th><th>Code</th><th>Name</th><th>Kind</th><th>Positions</th></tr></thead>
            <tbody>{equipment.map((x) => <tr key={x.id}><td>{x.line_code}</td><td className="mono">{x.code}</td><td>{x.name}</td><td>{x.kind}</td><td>{x.positions}</td></tr>)}</tbody></table></div>
          {allowed && <details style={{ marginTop: 12 }}><summary>Add equipment</summary>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <div className="field"><label htmlFor="el">Line</label><select id="el" value={e.lineId} onChange={(x) => setE({ ...e, lineId: x.target.value })}>{lines.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></div>
              <div className="field"><label htmlFor="ec">Code</label><input id="ec" value={e.code} onChange={(x) => setE({ ...e, code: x.target.value })} /></div>
              <div className="field"><label htmlFor="en">Name</label><input id="en" value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} /></div>
              <div className="field"><label htmlFor="ek">Kind</label><select id="ek" value={e.kind} onChange={(x) => setE({ ...e, kind: x.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
              <div><button disabled={busy || !e.code || !e.name} onClick={() => send({ action: "equipment", ...e }, "Equipment added.", () => setE({ ...e, code: "", name: "" }))}>Add equipment</button></div>
            </div></details>}
        </div>
        <div className="card">
          <h2>Part types</h2>
          <div className="tw"><table><thead><tr><th>Code</th><th>Name</th><th>Material</th><th>Planned life</th><th>Parts</th></tr></thead>
            <tbody>{partTypes.map((x) => <tr key={x.id}><td className="mono">{x.code}</td><td>{x.name}</td><td>{x.material}</td><td>{x.nominal_life_days} d</td><td>{x.parts}</td></tr>)}</tbody></table></div>
          <p className="small muted">The planned life is the planning figure for the seal type. It is not a prediction; phase 2 scores each position from its own history and conditions.</p>
          {allowed && <details style={{ marginTop: 8 }}><summary>Add part type</summary>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <div className="field"><label htmlFor="tc">Code</label><input id="tc" value={t.code} onChange={(x) => setT({ ...t, code: x.target.value })} /></div>
              <div className="field"><label htmlFor="tn">Name</label><input id="tn" value={t.name} onChange={(x) => setT({ ...t, name: x.target.value })} /></div>
              <div className="field"><label htmlFor="tm">Material</label><input id="tm" value={t.material} onChange={(x) => setT({ ...t, material: x.target.value })} /></div>
              <div className="field"><label htmlFor="ts">Supplier</label><input id="ts" value={t.supplier} onChange={(x) => setT({ ...t, supplier: x.target.value })} /></div>
              <div className="field"><label htmlFor="tl">Planned life (days)</label><input id="tl" type="number" min={1} value={t.nominalLifeDays} onChange={(x) => setT({ ...t, nominalLifeDays: x.target.value })} /></div>
              <div><button disabled={busy || !t.code || !t.name || !t.material} onClick={() => send({ action: "partType", ...t, nominalLifeDays: Number(t.nominalLifeDays), supplier: t.supplier || undefined }, "Part type added.", () => setT({ ...t, code: "", name: "", material: "" }))}>Add part type</button></div>
            </div></details>}
        </div>
      </div>
      {allowed && (
        <div className="card">
          <h2>Add a position</h2>
          <p className="small muted">A position is one place where a seal sits, for example &quot;Filling valve 9, plug seal&quot;. Criticality 1 to 5 is the consequence of a failure there: 5 is product contact or a route for foreign bodies. Codes cannot be changed later, and positions are retired, never deleted.</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="pe">Equipment</label><select id="pe" value={p.equipmentId} onChange={(x) => setP({ ...p, equipmentId: x.target.value })}>{equipment.map((x) => <option key={x.id} value={x.id}>{x.line_code} · {x.name}</option>)}</select></div>
            <div className="field"><label htmlFor="pa">Assembly</label><input id="pa" value={p.assembly} placeholder="Filling valve 9" onChange={(x) => setP({ ...p, assembly: x.target.value })} /></div>
            <div className="field"><label htmlFor="pc">Code</label><input id="pc" value={p.code} placeholder="V9-PLUG" onChange={(x) => setP({ ...p, code: x.target.value })} /></div>
            <div className="field"><label htmlFor="pn">Name</label><input id="pn" value={p.name} placeholder="Plug seal" onChange={(x) => setP({ ...p, name: x.target.value })} /></div>
            <div className="field"><label htmlFor="pf">Function (optional)</label><input id="pf" value={p.sealFunction} onChange={(x) => setP({ ...p, sealFunction: x.target.value })} /></div>
            <div className="field"><label htmlFor="pk">Criticality</label><select id="pk" value={p.criticality} onChange={(x) => setP({ ...p, criticality: x.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></div>
            <div><button disabled={busy || !p.code || !p.name || !p.assembly || !p.equipmentId} onClick={() => send({ action: "position", ...p, criticality: Number(p.criticality), sealFunction: p.sealFunction || undefined }, "Position added. Open it from the plant map to fit its first seal.", () => setP({ ...p, code: "", name: "" }))}>Add position</button></div>
          </div>
        </div>
      )}
    </>
  );
}

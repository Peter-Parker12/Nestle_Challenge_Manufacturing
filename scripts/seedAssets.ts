/* Synthetic plant data for the asset module. Nothing here is Nestle data. */
import type { Client } from "pg";
import { gauss, rng } from "../lib/rng";

const PART_TYPES = [
  { code: "EPDM-FV", name: "Filling valve plug seal", material: "EPDM", supplier: "Supplier A (synthetic)", life: 180, run: 2700, cip: 77, temp: 120, press: null },
  { code: "SIL-GK", name: "Valve body gasket", material: "Silicone", supplier: "Supplier B (synthetic)", life: 270, run: 4050, cip: 115, temp: 200, press: null },
  { code: "FKM-PS", name: "Homogeniser piston seal", material: "FKM", supplier: "Supplier A (synthetic)", life: 150, run: 2250, cip: null, temp: 200, press: 250 },
  { code: "PTFE-DIA", name: "UHT valve diaphragm", material: "PTFE / EPDM", supplier: "Supplier C (synthetic)", life: 365, run: 5500, cip: 150, temp: 140, press: 10 },
  { code: "EPDM-CIP", name: "CIP cup seal", material: "EPDM", supplier: "Supplier A (synthetic)", life: 240, run: 3600, cip: 103, temp: 110, press: null },
  { code: "EPDM-MW", name: "Manway gasket", material: "EPDM", supplier: "Supplier B (synthetic)", life: 360, run: 5400, cip: 154, temp: 120, press: null },
  { code: "SIL-SG", name: "Sight glass gasket", material: "Silicone", supplier: "Supplier B (synthetic)", life: 300, run: 4500, cip: 128, temp: 200, press: null },
];

const FINDINGS: Record<number, string[]> = {
  1: ["Surface smooth, no marks", "As new"],
  2: ["Slight surface dulling", "Light compression set"],
  3: ["Visible wear on sealing lip", "Surface cracking starting", "Flattened profile"],
  4: ["Edge chipped, fragments possible", "Deep cracks across lip", "Torn at the sealing edge"],
  5: ["Failed: split through", "Failed: missing piece"],
};

export async function seedAssets(c: Client, o: { lines: { id: string; code: string }[]; users: Record<string, string>; history: boolean }) {
  const ins = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0];
  const types: Record<string, { id: string; life: number }> = {};
  for (const t of PART_TYPES)
    types[t.code] = { life: t.life, id: (await ins("insert into ast.part_type(code,name,material,supplier,nominal_life_days,nominal_run_hours,nominal_cip_cycles,max_temp_c,max_pressure_bar) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id", [t.code, t.name, t.material, t.supplier, t.life, t.run, t.cip, t.temp, t.press])).id };
  if (!o.history) return { positions: 0, parts: 0 };

  const r = rng(20261111);
  const base = new Date(); base.setUTCHours(0, 0, 0, 0);
  const day = (offset: number) => new Date(base.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const maint = o.users.maintenance, qa = o.users.qa;
  let partSeq = 10000, nPos = 0, nParts = 0;

  type Pos = { equipment: string; assembly: string; code: string; name: string; fn: string; crit: number; type: string; hot?: boolean };
  const plan = (line: string) => {
    const L: Pos[] = [];
    for (let v = 1; v <= 8; v++) {
      L.push({ equipment: "FL", assembly: `Filling valve ${v}`, code: `V${v}-PLUG`, name: "Plug seal", fn: "Product contact, shuts the fill", crit: 5, type: "EPDM-FV", hot: line === "L1" && v === 3 });
      L.push({ equipment: "FL", assembly: `Filling valve ${v}`, code: `V${v}-BODY`, name: "Body gasket", fn: "Valve body joint", crit: 4, type: "SIL-GK" });
    }
    for (let v = 1; v <= 2; v++) L.push({ equipment: "FL", assembly: `Product inlet ${v}`, code: `IN${v}-CIP`, name: "CIP cup seal", fn: "Seals the CIP return", crit: 3, type: "EPDM-CIP" });
    for (let p = 1; p <= 3; p++) L.push({ equipment: "HM", assembly: `Piston ${p}`, code: `P${p}-SEAL`, name: "Piston seal", fn: "High-pressure product side", crit: 4, type: "FKM-PS" });
    L.push({ equipment: "HM", assembly: "Valve seat", code: "VS-GK", name: "Valve seat gasket", fn: "Homogenising valve", crit: 4, type: "SIL-GK" });
    for (let v = 1; v <= 6; v++) L.push({ equipment: "UV", assembly: `UHT valve ${v}`, code: `UV${v}-DIA`, name: "Diaphragm", fn: "Product contact, divert valve", crit: 5, type: "PTFE-DIA" });
    L.push({ equipment: "UV", assembly: "Balance tank", code: "BT-MW", name: "Manway gasket", fn: "Tank access", crit: 3, type: "EPDM-MW" });
    L.push({ equipment: "UV", assembly: "Balance tank", code: "BT-SG", name: "Sight glass gasket", fn: "Level viewing", crit: 3, type: "SIL-SG" });
    return L;
  };
  const EQ: Record<string, [string, string, string]> = { FL: ["Filler", "filler", "FL"], HM: ["Homogeniser", "homogeniser", "HM"], UV: ["UHT valve cluster", "valve_cluster", "UV"] };

  for (const line of o.lines.filter((l) => l.code === "L1" || l.code === "L2")) {
    const eq: Record<string, string> = {};
    for (const [code, [name, kind]] of Object.entries(EQ))
      eq[code] = (await ins("insert into ast.equipment(line_id,code,name,kind) values ($1,$2,$3,$4) returning id", [line.id, code, name, kind])).id;

    for (const p of plan(line.code)) {
      const pid = (await ins("insert into ast.position(equipment_id,code,name,assembly,seal_function,criticality) values ($1,$2,$3,$4,$5,$6) returning id", [eq[p.equipment], p.code, p.name, p.assembly, p.fn, p.crit])).id;
      nPos++;
      const T = types[p.type];

      // build the chain backwards from today, so the current seal's age is known
      type Seg = { start: number; end: number | null; reason: string | null };
      const segs: Seg[] = [];
      const age0 = p.hot ? Math.round(T.life * 1.12) : Math.round(T.life * (r() < 0.18 ? 0.95 + r() * 0.35 : 0.08 + r() * 0.9));
      let start = -age0;
      segs.push({ start, end: null, reason: null });
      while (start > -400) {
        const life = Math.max(20, Math.round(T.life * Math.min(1.35, Math.max(0.35, 1 + 0.22 * gauss(r)))));
        const prem = r() < (p.crit >= 4 ? 0.14 : 0.07);
        const used = prem ? Math.round(life * (0.35 + r() * 0.3)) : life;
        const end = start;                       // the previous seal was removed the day the next went in
        start = end - used;
        const reason = prem ? "failure" : r() < 0.15 ? "inspection_finding" : "planned_replacement";
        segs.unshift({ start, end, reason });
      }
      for (const s of segs) {
        const code = `S-${p.type}-${++partSeq}`;
        const part = (await ins("insert into ast.part(code,part_type_id,lot,received_on) values ($1,$2,$3,$4) returning id", [code, T.id, `LOT-${day(s.start - 20).slice(2, 4)}${day(s.start - 20).slice(5, 7)}`, day(s.start - 5 - Math.floor(r() * 40))])).id;
        nParts++;
        const inst = (await ins("insert into ast.installation(part_id,position_id,installed_on,installed_by) values ($1,$2,$3,$4) returning id", [part, pid, day(s.start), maint])).id;
        const endDay = s.end ?? 0;
        const span = endDay - s.start;
        // inspections: one mid-life, one near the end (or recent, for the current seal)
        const marks = span > 60 ? [0.55, 0.9] : span > 25 ? [0.8] : [];
        for (const f of marks) {
          const when = s.start + Math.max(1, Math.round(span * f));
          if (when > 0) continue;
          const wear = (when - s.start) / T.life;
          const rating = Math.min(5, Math.max(1, Math.round(1 + wear * 2.3 + 0.45 * gauss(r)))) as 1 | 2 | 3 | 4 | 5;
          const text = FINDINGS[Math.min(rating, s.reason === "failure" ? 5 : 4)];
          await c.query("insert into ast.inspection(installation_id,inspected_on,rating,finding,inspector_id) values ($1,$2,$3,$4,$5)", [inst, day(when), rating, text[Math.floor(r() * text.length)], r() < 0.7 ? maint : qa]);
        }
        if (s.end !== null) {
          if (s.reason === "failure") {
            const lead = 20 + Math.floor(r() * 25);
            if (span > 50 && r() < 0.8) await c.query("insert into ast.inspection(installation_id,inspected_on,rating,finding,inspector_id) values ($1,$2,$3,$4,$5)", [inst, day(s.end - lead), r() < 0.5 ? 3 : 4, pick(r, FINDINGS[3]), maint]);
            await c.query("insert into ast.inspection(installation_id,inspected_on,rating,finding,inspector_id) values ($1,$2,5,$3,$4)", [inst, day(s.end), pick(r, FINDINGS[5]), maint]);
            if (r() < 0.85) await c.query("insert into ast.incident(position_id,installation_id,occurred_on,kind,severity,description,reported_by) values ($1,$2,$3,$4,$5,$6,$7)",
              [pid, inst, day(s.end), p.crit >= 4 && r() < 0.5 ? "foreign_body" : "seal_failure", "Major", "Found at the stop. Seal replaced.", maint]);
          }
          await c.query("update ast.installation set removed_on=$2, removal_reason=$3 where id=$1", [inst, day(s.end), s.reason]);
        }
      }
      if (p.hot) {
        // the demo story: this seal is past its planned life, was rated poor, and has already shed a fragment
        const cur = (await ins("select id from ast.installation where position_id=$1 and removed_on is null", [pid])).id;
        await c.query("insert into ast.inspection(installation_id,inspected_on,rating,finding,inspector_id) values ($1,$2,4,$3,$4)", [cur, day(-9), "Edge chipped, fragments possible", maint]);
        await c.query("insert into ast.incident(position_id,installation_id,occurred_on,kind,severity,description,reported_by) values ($1,$2,$3,'foreign_body','Major',$4,$5)",
          [pid, cur, day(-6), "Small black fragment found in a rejected pack at the filler outlet. Source not confirmed.", qa]);
      }
    }
  }

  // exposure ledger: one row per equipment per week for the last ~58 weeks (synthetic, with realistic variation)
  const monday = (offset: number) => { const d = new Date(base.getTime() + offset * 86400000); const dow = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10); };
  const eqRows = await c.query("select e.id, e.code, l.code as line from ast.equipment e join cfg.line l on l.id=e.line_id");
  for (const e of eqRows.rows) {
    for (let w = 58; w >= 0; w--) {
      const wk = monday(-w * 7);
      if (wk > day(0)) continue;
      const hot = e.line === "L1";
      let run = 98 + r() * 18, cip = 3, avgT = 24, maxT = 85 + r() * 10, avgP = 3 + r(), maxP = 4 + r() * 2;
      if (e.code === "FL" && r() < (hot ? 0.14 : 0.03)) maxT = 121 + r() * 6;
      if (e.code === "HM") { cip = 2; avgT = 60; maxT = 72 + r() * 6; avgP = 185 + r() * 45; maxP = avgP + 12 + r() * 25; if (r() < 0.1) run = 60 + r() * 20; }
      if (e.code === "UV") { avgT = 130; maxT = (hot ? 134 : 133) + r() * (hot ? 9.5 : 6); avgP = 5 + r() * 3; maxP = avgP + 1 + r() * 2.2; }
      if (r() < 0.06) { run = 40 + r() * 30; cip += 1; }   // a short week
      await c.query("insert into ast.exposure(equipment_id,week_start,run_hours,cip_cycles,avg_temp_c,max_temp_c,avg_pressure_bar,max_pressure_bar,source) values ($1,$2,$3,$4,$5,$6,$7,$8,'synthetic')",
        [e.id, wk, round1(run), cip, round1(avgT), round1(maxT), round1(avgP), round1(maxP)]);
    }
  }

  // planned stops: weekly CIP, changeovers and a few maintenance windows, past and future
  for (const line of o.lines.filter((l) => l.code === "L1" || l.code === "L2")) {
    const off = line.code === "L1" ? 0 : 2;
    for (let w = -12; w <= 10; w++) {
      const d = w * 7 + off;
      await c.query("insert into ast.planned_stop(line_id,start_on,end_on,kind,note,status,created_by) values ($1,$2,$2,'CIP','Weekly CIP',$3,$4)", [line.id, day(d), d < 0 ? "Done" : "Planned", o.users.plant_admin]);
    }
    for (const [d, len, kind, note] of [[-40, 2, "maintenance", "Quarterly maintenance"], [9 + off, 2, "maintenance", "Valve and seal service window"], [37 + off, 1, "changeover", "Format changeover"], [75 + off, 4, "shutdown", "Planned shutdown"]] as const)
      await c.query("insert into ast.planned_stop(line_id,start_on,end_on,kind,note,status,created_by) values ($1,$2,$3,$4,$5,$6,$7)", [line.id, day(d), day(d + len - 1), kind, note, d < 0 ? "Done" : "Planned", o.users.plant_admin]);
  }
  return { positions: nPos, parts: nParts };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
function pick<T>(r: () => number, a: T[]) { return a[Math.floor(r() * a.length)]; }

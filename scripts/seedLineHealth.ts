/* Synthetic line-health data for the fillers. Nothing here is Nestle data. */
import type { Client } from "pg";
import { gauss, rng } from "../lib/rng";

const GUIDES = [
  { code: "G-FILLWT", title: "Fill weight out of tolerance", alarms: ["A-FW-03"], kw: ["fill weight", "underfill", "overfill", "dosing"], steps: [
    "Apply lockout and tagout per the site SOP before opening anything.",
    "Check the fill dwell time and fill pressure against the centerline for this station. Record both.",
    "Inspect the filling valve plug seal for wear, chips or flattening. Compare with a new seal.",
    "Check the valve body gasket for leaks or weeping at the joint.",
    "Check the product supply pressure at the inlet and look for air in the line.",
    "If a seal is damaged, replace it, record the seal change in the system, and run 10 packs to confirm the weight.",
  ] },
  { code: "G-VALVE-CLOSE", title: "Filling valve slow to close or not closing", alarms: ["A-VLV-11"], kw: ["valve", "slow", "stuck", "leak", "drip"], steps: [
    "Apply lockout and tagout per the site SOP.",
    "Check the compressed air supply to the valve actuator and look for air leaks.",
    "Remove the valve and inspect the plug seal and seat for wear or product build-up.",
    "Clean the seat. Replace the plug seal if it is worn, hardened or chipped, and record the change.",
    "Refit, run a CIP check, then run test packs and watch the closing time.",
  ] },
  { code: "G-CIP-TEMP", title: "CIP temperature low", alarms: ["A-CIP-02"], kw: ["cip", "temperature", "cleaning"], steps: [
    "Check the CIP supply temperature on the CIP skid against the recipe.",
    "Check steam supply and the heat exchanger for fouling.",
    "Repeat the CIP step. Do not release the line until the temperature and time are met and recorded.",
  ] },
  { code: "G-PRESS-LOW", title: "Product pressure low", alarms: ["A-PRS-07"], kw: ["pressure", "product", "pump"], steps: [
    "Check the product tank level and the supply valve position.",
    "Check the supply pump for noise, leaks or cavitation.",
    "Check the inlet filter and the CIP cup seal for leaks.",
    "Restart and confirm the pressure is back inside the centerline before running.",
  ] },
  { code: "G-CAP-TORQUE", title: "Cap torque out of range", alarms: ["A-CAP-05"], kw: ["cap", "torque", "capper"], steps: [
    "Apply lockout and tagout per the site SOP.",
    "Check the chuck for wear and the torque setting against the centerline.",
    "Check the caps from the current lot for dimensions.",
    "Re-run and test torque on 5 packs with the torque tester.",
  ] },
];

export async function seedLineHealth(c: Client, o: { users: Record<string, string> }) {
  const r = rng(20261112);
  const ins = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0];
  const base = new Date(); base.setUTCHours(0, 0, 0, 0);
  const at = (offset: number, hour = 12) => new Date(base.getTime() + offset * 86400000 + hour * 3600000).toISOString();
  const day = (offset: number) => new Date(base.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const pickOf = <T,>(a: T[]) => a[Math.floor(r() * a.length)];

  for (const g of GUIDES)
    await c.query("insert into ops.guide(code,title,alarm_codes,keywords,steps,source,created_by) values ($1,$2,$3,$4,$5,'Synthetic demo SOP',$6)",
      [g.code, g.title, g.alarms, g.kw, JSON.stringify(g.steps.map((text, i) => ({ n: i + 1, text }))), o.users.maintenance]);

  const fillers = (await c.query("select e.id, l.code as line from ast.equipment e join cfg.line l on l.id=e.line_id where e.kind='filler'")).rows;
  const ALARM: Record<string, [string, string]> = {
    "A-FW-03": ["A-FW-03", "Fill weight out of tolerance"], "A-VLV-11": ["A-VLV-11", "Valve slow to close"], "A-PRS-07": ["A-PRS-07", "Product pressure low"],
    "A-CIP-02": ["A-CIP-02", "CIP temperature low"], "A-CAP-05": ["A-CAP-05", "Cap torque out of range"],
  };
  const sev = () => { const x = r(); return x < 0.12 ? "Fault" : x < 0.82 ? "Warning" : "Info"; };

  for (const f of fillers) {
    const story = f.line === "L1";
    const st: Record<string, { id: string; kind: "valve" | "inlet" | "capper" }> = {};
    const add = async (code: string, name: string, assembly: string | null, kind: "valve" | "inlet" | "capper") => { st[code] = { kind, id: (await ins("insert into ops.station(equipment_id,code,name,assembly) values ($1,$2,$3,$4) returning id", [f.id, code, name, assembly])).id }; };
    for (let v = 1; v <= 8; v++) await add(`V${v}`, `Filling valve ${v}`, `Filling valve ${v}`, "valve");
    for (let v = 1; v <= 2; v++) await add(`IN${v}`, `Product inlet ${v}`, `Product inlet ${v}`, "inlet");
    await add("CAP", "Capper", null, "capper");

    // settings with their approved windows
    for (const [code, s] of Object.entries(st)) {
      const set = (sc: string, name: string, unit: string, target: number, lo: number, hi: number, cur: number) =>
        c.query("insert into ops.setting(station_id,code,name,unit,target,min_value,max_value,current_value) values ($1,$2,$3,$4,$5,$6,$7,$8)", [s.id, sc, name, unit, target, lo, hi, cur]);
      if (s.kind === "valve") {
        const hotV3 = story && code === "V3", hotV6 = story && code === "V6";
        await set("fill_dwell_ms", "Fill dwell time", "ms", 400, 380, 420, hotV3 ? 416 : 400 + Math.round(gauss(r) * 2));
        await set("fill_pressure_bar", "Fill pressure", "bar", 2.4, 2.2, 2.6, hotV3 ? 2.52 : hotV6 ? 2.61 : Math.round((2.4 + gauss(r) * 0.02) * 100) / 100);
      } else if (s.kind === "capper") await set("cap_torque_nm", "Cap torque", "Nm", 1.8, 1.6, 2.0, 1.8);
    }

    // alarms: a quiet baseline for 70 days
    const stations = Object.entries(st);
    for (const [code, s] of stations) {
      const codes = s.kind === "valve" ? ["A-FW-03", "A-VLV-11", "A-PRS-07"] : s.kind === "inlet" ? ["A-CIP-02", "A-PRS-07"] : ["A-CAP-05"];
      for (let d = -69; d <= 0; d++) {
        if (r() > 0.17) continue;                                   // about 1.2 alarms a week
        const a = ALARM[pickOf(codes)];
        await c.query("insert into ops.alarm_event(equipment_id,station_id,occurred_at,code,description,severity,duration_s) values ($1,$2,$3,$4,$5,$6,$7)", [f.id, s.id, at(d, d === 0 ? 1 + Math.floor(r() * 3) : 5 + Math.floor(r() * 16)), a[0], a[1], sev(), 10 + Math.floor(r() * 120)]);
      }
    }
    const burst = async (code: string, startDay: number, n: number, faultShare: number, alarmCodes: string[]) => {
      for (let i = 0; i < n; i++) {
        const a = ALARM[alarmCodes[i % alarmCodes.length]];
        const dd = startDay + Math.floor(r() * 7) - 6;
        await c.query("insert into ops.alarm_event(equipment_id,station_id,occurred_at,code,description,severity,duration_s) values ($1,$2,$3,$4,$5,$6,$7)",
          [f.id, st[code].id, at(dd, dd >= 0 ? 1 + Math.floor(r() * 3) : 4 + Math.floor(r() * 18)), a[0], a[1], r() < faultShare ? "Fault" : "Warning", 20 + Math.floor(r() * 200)]);
      }
    };

    // breakdowns, each preceded by a rise in faults at that station
    const bd: [string, number, number, string, string][] = story
      ? [["V3", -118, 62, "Plug seal worn, valve not closing", "Replaced plug seal and cleaned the seat"], ["V5", -201, 45, "Body gasket leaking at the valve joint", "Replaced the body gasket"],
        ["IN2", -64, 38, "CIP cup seal leak", "Replaced the CIP cup seal"], ["CAP", -33, 20, "Cap chute jam", "Cleared the jam, adjusted the chute"], ["V3", -9, 28, "Valve stuck open, fill weight high", "Cleaned the seat, valve to be inspected at the next stop"]]
      : [["V1", -150, 41, "Plug seal worn", "Replaced plug seal"], ["V4", -77, 33, "Valve slow to close", "Replaced the actuator seal"], ["V6", -20, 18, "Cap chute jam", "Cleared the jam"]];
    for (const [sc, off, min, cause, fix] of bd) {
      await c.query("insert into ops.breakdown(equipment_id,station_id,started_at,minutes,cause,fix) values ($1,$2,$3,$4,$5,$6)", [f.id, st[sc].id, at(off, 9), min, cause, fix]);
      if (sc !== "CAP" && off < -69) await burst(sc, off, 7 + Math.floor(r() * 4), 1, ["A-FW-03", "A-VLV-11"]);   // before the baseline window
    }
    if (story) {
      // the demo story: filling valve 3 gets steadily worse over six weeks (extra alarms per week, oldest first)
      const ramp = [2, 4, 6, 9, 13, 18];
      for (let i = 0; i < ramp.length; i++) await burst("V3", -7 * (ramp.length - 1 - i), ramp[i], 0.6, ["A-FW-03", "A-VLV-11", "A-FW-03"]);
      await burst("V6", 0, 3, 0.2, ["A-PRS-07"]);
      for (let d = -13; d <= 0; d++) if (r() < 0.9) await c.query("insert into ops.defect(equipment_id,station_id,occurred_on,kind,qty) values ($1,$2,$3,'Underfill',$4)", [f.id, st.V3.id, day(d), 1 + Math.floor(r() * 2)]);
    }
    for (let d = -60; d <= 0; d++) if (r() < 0.12) await c.query("insert into ops.defect(equipment_id,station_id,occurred_on,kind,qty) values ($1,$2,$3,$4,$5)", [f.id, st[pickOf(["V1", "V2", "V4", "V5", "V7", "V8", "CAP"])].id, day(d), pickOf(["Leak", "Cap loose", "Underfill"]), 1 + Math.floor(r() * 2)]);

    // daily KPIs
    for (let d = -119; d <= 0; d++) {
      const bad = story && d > -10;
      const eups = Math.max(40, 78 + gauss(r) * 2.5 - (bad ? 6 + (d + 10) * 0.2 : 0));
      const down = Math.max(0, 18 + gauss(r) * 8 + (bad ? 22 : 0) + (story && d === -9 ? 28 : 0));
      await c.query("insert into ops.kpi_daily(equipment_id,day,eups,speed_pct,unplanned_downtime_min,defects,material_loss_kg) values ($1,$2,$3,$4,$5,$6,$7)",
        [f.id, day(d), Math.round(eups * 10) / 10, Math.round((92 + gauss(r) * 2 - (bad ? 4 : 0)) * 10) / 10, Math.round(down), Math.max(0, Math.round(3 + gauss(r) * 2 + (bad ? 8 : 0))), Math.round((12 + gauss(r) * 3 + (bad ? 9 : 0)) * 10) / 10]);
    }

    // maintenance records: CIL on every station, one overdue in the story, a centerlining check and a PM03
    for (const [code, s] of stations) {
      const overdue = (story && code === "V3") ? -9 : (!story && code === "IN1") ? -3 : null;
      await c.query("insert into ops.maintenance_task(equipment_id,station_id,kind,title,due_on,done_on) values ($1,$2,'CIL',$3,$4,$5)", [f.id, s.id, `Clean, inspect and lubricate ${code}`, day(-21), day(-20)]);
      await c.query("insert into ops.maintenance_task(equipment_id,station_id,kind,title,due_on,done_on) values ($1,$2,'CIL',$3,$4,$5)", [f.id, s.id, `Clean, inspect and lubricate ${code}`, day(overdue ?? -7), overdue === null ? day(-7) : null]);
    }
    await c.query("insert into ops.maintenance_task(equipment_id,kind,title,due_on) values ($1,'centerlining','Monthly centerlining check',$2)", [f.id, day(6)]);
    await c.query("insert into ops.maintenance_task(equipment_id,kind,title,due_on) values ($1,'PM03','Quarterly PM03 service',$2)", [f.id, day(20)]);
  }
}

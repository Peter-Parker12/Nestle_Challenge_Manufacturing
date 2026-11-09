/* Synthetic demo data. Nothing here is Nestle data. */
import { Client } from "pg";
import { deriveRunResult } from "../lib/engine/outcome";
import { gauss, rng } from "../lib/rng";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const args = process.argv.slice(2);
const IF_EMPTY = args.includes("--if-empty");
const FORCE = args.includes("--force");
const DEMO = !args.includes("--config-only"); // config-only = users, lines, parameters, rules, no launches

const r = rng(20261108);
const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
const rnd = (lo: number, hi: number) => lo + r() * (hi - lo);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

async function main() {
  const c = new Client({ connectionString: url });
  await c.connect();
  const existing = await c.query("select count(*)::int as n from cfg.category");
  if (existing.rows[0].n > 0) {
    if (IF_EMPTY) {
      console.log("[seed] database already has data, skipping");
      return c.end();
    }
    if (!FORCE) {
      console.error("[seed] database is not empty. Use --force to wipe and reseed.");
      process.exit(1);
    }
    await c.query(`truncate cfg.app_user, cfg.category, cfg.reason_code, cfg.line, ai.document, ai.call_log, audit.event, stg.load restart identity cascade`);
    await c.query("alter sequence core.launch_code_seq restart with 1000");
  }
  await c.query("begin");
  await c.query("select set_config('app.reason', 'seed', true)");
  try {
    await seed(c);
    await c.query("commit");
    console.log("[seed] done");
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
  await c.end();
}

async function seed(c: Client) {
  const ins = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0];

  // ---- users
  const users: Record<string, string> = {};
  for (const [name, email, role] of [
    ["Linh Tran (R&D)", "linh.rd@demo.local", "rd_engineer"],
    ["Minh Nguyen (Process)", "minh.process@demo.local", "process_engineer"],
    ["Hoa Pham (QA)", "hoa.qa@demo.local", "qa"],
    ["An Le (Category owner)", "an.owner@demo.local", "category_owner"],
    ["Bao Vo (Supply Chain)", "bao.sc@demo.local", "supply_chain"],
    ["Chi Dang (Plant admin)", "chi.admin@demo.local", "plant_admin"],
    ["Dung Hoang (Viewer)", "dung.view@demo.local", "viewer"],
  ]) users[role] = (await ins("insert into cfg.app_user(name,email,role) values ($1,$2,$3) returning id", [name, email, role])).id;

  // ---- reason codes
  for (const [code, label] of [
    ["viscosity_off", "Viscosity out of target"], ["sedimentation", "Sedimentation"], ["creaming", "Creaming / fat separation"],
    ["ph_off", "pH out of range"], ["sterility_concern", "Sterility concern"], ["filling_issue", "Filling issue"],
    ["equipment_issue", "Equipment issue"], ["material_issue", "Raw or packaging material issue"], ["other", "Other"],
  ]) await c.query("insert into cfg.reason_code(code,label) values ($1,$2)", [code, label]);

  // ---- lines
  const lines: { id: string; code: string }[] = [];
  for (const [code, name] of [["L1", "UHT Line 1"], ["L2", "UHT Line 2"], ["L3", "UHT Line 3"]])
    lines.push({ code, id: (await ins("insert into cfg.line(code,name,plant) values ($1,$2,'Demo Plant') returning id", [code, name])).id });

  // ---- category 1: UHT drinks (populated)
  const cat = (await ins("insert into cfg.category(code,name,owner_user_id) values ('UHT_DRINK','UHT drinks (RTD)',$1) returning id", [users.category_owner])).id;
  const steps: Record<string, string> = {};
  for (const [i, name] of ["Homogenisation", "UHT treatment", "Filling"].entries())
    steps[name] = (await ins("insert into cfg.process_step(category_id,name,seq) values ($1,$2,$3) returning id", [cat, name, i + 1])).id;

  const P: Record<string, { id: string; min: number; max: number; ideal: (a: A) => number; sd: number; capMin: number; capMax: number }> = {};
  type A = { viscosity_cp: number; fat_pct: number; solids_pct: number };
  const pdefs: [string, string, string, string, number, number, boolean, boolean, (a: A) => number, number, number, number][] = [
    // step, code, name, unit, absMin, absMax, critical, locked, ideal, sd, capMin, capMax
    ["Homogenisation", "homog_pressure_bar", "Homogenisation pressure", "bar", 100, 320, true, false, (a) => 120 + a.viscosity_cp * 2.2 + a.solids_pct * 1.5, 22, 130, 300],
    ["UHT treatment", "uht_temp_c", "UHT holding temperature", "°C", 134, 146, true, true, (a) => 139 + a.fat_pct * 0.6, 1.4, 136, 144],
    ["UHT treatment", "hold_time_s", "Holding time", "s", 2, 8, false, false, (a) => 4 + a.solids_pct * 0.05, 0.4, 3, 7],
    ["Filling", "fill_temp_c", "Filling temperature", "°C", 10, 35, false, false, () => 22, 3, 14, 30],
    ["Filling", "flow_rate_lph", "Flow rate", "L/h", 3000, 7000, false, false, (a) => 5200 - a.viscosity_cp * 15, 150, 3500, 6500],
  ];
  for (const [step, code, name, unit, mn, mx, crit, locked, ideal, sd, cmin, cmax] of pdefs) {
    const id = (await ins("insert into cfg.parameter_def(step_id,code,name,unit,abs_min,abs_max,is_critical,is_locked) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id", [steps[step], code, name, unit, mn, mx, crit, locked])).id;
    P[code] = { id, min: mn, max: mx, ideal, sd, capMin: cmin, capMax: cmax };
    for (const l of lines) await c.query("insert into cfg.line_capability values ($1,$2,$3,$4)", [l.id, id, cmin, cmax]);
  }

  const AT: Record<string, string> = {};
  for (const [code, name, unit, type, choices, req, mn, mx] of [
    ["viscosity_cp", "Target viscosity", "cP", "numeric", null, true, 5, 60],
    ["fat_pct", "Fat", "%", "numeric", null, true, 0, 5],
    ["solids_pct", "Total solids", "%", "numeric", null, true, 5, 25],
    ["ph", "pH", null, "numeric", null, false, 6.0, 7.2],
    ["pack_ml", "Pack size", "ml", "numeric", null, false, 100, 1000],
    ["base", "Base", null, "choice", JSON.stringify(["milk", "plant", "coffee", "cocoa", "cereal"]), true, null, null],
  ] as const)
    AT[code] = (await ins("insert into cfg.attribute_def(category_id,code,name,unit,data_type,choices,required,abs_min,abs_max) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id", [cat, code, name, unit, type, choices, req, mn, mx])).id;

  const QT: Record<string, { id: string; crit: boolean }> = {};
  for (const [code, name, unit, crit] of [
    ["viscosity_cp", "Viscosity", "cP", true], ["sediment_pct", "Sediment", "%", true],
    ["creaming_idx", "Creaming index", null, true], ["ph", "pH", null, false],
  ] as const)
    QT[code] = { crit, id: (await ins("insert into cfg.quality_test_def(category_id,code,name,unit,is_critical) values ($1,$2,$3,$4,$5) returning id", [cat, code, name, unit, crit])).id };

  // ---- category 2: sauces (configured only, no trials: shows the multi-category structure)
  const cat2 = (await ins("insert into cfg.category(code,name,owner_user_id) values ('SAUCE','Sauces (configured, no history yet)',$1) returning id", [users.category_owner])).id;
  const s2 = (await ins("insert into cfg.process_step(category_id,name,seq) values ($1,'Cooking',1) returning id", [cat2])).id;
  await c.query("insert into cfg.parameter_def(step_id,code,name,unit,abs_min,abs_max,is_critical) values ($1,'cook_temp_c','Cooking temperature','°C',60,110,true), ($1,'cook_time_min','Cooking time','min',5,60,false)", [s2]);
  await c.query(`insert into cfg.attribute_def(category_id,code,name,unit,data_type,required,abs_min,abs_max) values
    ($1,'salt_pct','Salt','%','numeric',true,5,25), ($1,'ph','pH',null,'numeric',true,3,6), ($1,'viscosity_cp','Viscosity','cP','numeric',false,50,5000)`, [cat2]);

  // ---- SME rules
  for (const [cond, sev, msg] of [
    [{ attr: "fat_pct", op: ">", value: 2.5 }, "Medium", "High fat: raise the homogenisation window and add a creaming stability check to shelf-life testing."],
    [{ attr: "solids_pct", op: ">", value: 15 }, "Medium", "High solids: sedimentation risk. Consider a stabiliser trial arm."],
    [{ attr: "viscosity_cp", op: ">", value: 35 }, "Medium", "High target viscosity: watch fouling on the UHT heat exchanger and filler line pressure."],
  ] as const)
    await c.query("insert into cfg.sme_rule(category_id,condition,risk_effect,message,owner_user_id,approved_by) values ($1,$2,$3,$4,$5,$5)",
      [cat, JSON.stringify(cond), JSON.stringify({ severity: sev }), msg, users.category_owner]);

  // ---- weights: platform-wide default is implicit (level 3). Category default set by the owner.
  const ws = (await ins("insert into rec.weight_set(level,category_id,status,created_by,approved_by,reason) values ('category',$1,'Active',$2,$2,'Initial category defaults') returning id", [cat, users.category_owner])).id;
  const aw: Record<string, number> = { viscosity_cp: 5, fat_pct: 4, solids_pct: 4, ph: 1, pack_ml: 1, base: 3 };
  const pw: Record<string, number> = { homog_pressure_bar: 5, uht_temp_c: 5, hold_time_s: 3, fill_temp_c: 1, flow_rate_lph: 2 };
  for (const [k, v] of Object.entries(aw)) await c.query("insert into rec.weight_item values ($1,'attribute',$2,$3)", [ws, AT[k], v]);
  for (const [k, v] of Object.entries(pw)) await c.query("insert into rec.weight_item values ($1,'parameter',$2,$3)", [ws, P[k].id, v]);

  // ---- history: ~60 closed launches (demo mode only)
  let launchCount = 0;
  if (DEMO) {
  const names = ["Milk Tea", "Choco Malt", "Coffee Latte", "Oat Drink", "Cereal Beverage", "Cocoa", "Soy Milk", "Almond Drink", "Iced Coffee", "Malt Drink"];
  const bases = ["milk", "plant", "coffee", "cocoa", "cereal"];
  for (let i = 0; i < 60; i++) {
    const base = pick(bases);
    const a: A & { ph: number; pack_ml: number } = {
      viscosity_cp: Math.round(rnd(8, 46)), fat_pct: round(rnd(0.5, 3.4), 1), solids_pct: round(rnd(8, 17.5), 1),
      ph: round(rnd(6.45, 6.85), 2), pack_ml: pick([180, 200, 250]),
    };
    const line = pick(lines);
    const pid = (await ins("insert into core.product(category_id,code,name,format) values ($1,$2,$3,$4) returning id", [cat, `H-${String(i + 1).padStart(3, "0")}`, `${pick(names)} ${a.pack_ml}ml (${base})`, `${a.pack_ml}ml carton`])).id;
    for (const k of ["viscosity_cp", "fat_pct", "solids_pct", "ph", "pack_ml"] as const)
      await c.query("insert into core.product_attribute_value(product_id,attribute_def_id,value_num) values ($1,$2,$3)", [pid, AT[k], a[k]]);
    await c.query("insert into core.product_attribute_value(product_id,attribute_def_id,value_choice) values ($1,$2,$3)", [pid, AT.base, base]);
    const spec = { viscosity_cp: [a.viscosity_cp * 0.92, a.viscosity_cp * 1.08], sediment_pct: [null, 0.5], creaming_idx: [null, 1.6], ph: [6.5, 6.9] } as Record<string, (number | null)[]>;
    for (const [k, [mn, mx]] of Object.entries(spec))
      await c.query("insert into core.product_spec values ($1,$2,$3,$4)", [pid, QT[k].id, mn === null ? null : round(mn, 2), mx === null ? null : round(mx, 2)]);

    const created = new Date(Date.UTC(2024, 10, 1) + Math.floor(rnd(0, 700)) * 86400000);
    const lid = (await ins("insert into core.launch_project(product_id,line_id,objective,status,created_by,created_at) values ($1,$2,$3,'Draft',$4,$5) returning id", [pid, line.id, "Launch on " + line.code, users.rd_engineer, created])).id;

    // Initial engineer guess is off from the hidden ideal window by a few sigma.
    const spread = { homog_pressure_bar: 1.6, uht_temp_c: 1.6, hold_time_s: 1.0, fill_temp_c: 1.0, flow_rate_lph: 1.0 } as Record<string, number>;
    const z: Record<string, number> = {};
    for (const k of Object.keys(P)) z[k] = gauss(r) * spread[k];
    let day = 0;
    let accepted = false;
    for (let run = 1; run <= 6 && !accepted; run++) {
      const actual: Record<string, number> = {};
      for (const [k, p] of Object.entries(P)) actual[k] = round(p.ideal(a) + z[k] * p.sd, 2);
      const vis = a.viscosity_cp * (1 - 0.045 * z.homog_pressure_bar + gauss(r) * 0.012);
      const sed = 0.2 + 0.16 * Math.max(0, -z.homog_pressure_bar) + 0.1 * Math.max(0, -z.uht_temp_c) + gauss(r) * 0.02;
      const cream = 1.0 + 0.25 * Math.max(0, -z.homog_pressure_bar) * (a.fat_pct / 2) + 0.05 * Math.abs(z.uht_temp_c) + gauss(r) * 0.03;
      const ph = 6.7 - 0.035 * z.uht_temp_c + gauss(r) * 0.04;
      const vals: Record<string, number> = { viscosity_cp: round(vis, 1), sediment_pct: round(sed, 3), creaming_idx: round(cream, 3), ph: round(ph, 2) };

      const quality = Object.entries(vals).map(([code, value]) => ({
        code, value, specMin: spec[code][0] === null ? null : round(spec[code][0]!, 2), specMax: spec[code][1] === null ? null : round(spec[code][1]!, 2), critical: QT[code].crit,
      }));
      const out = deriveRunResult({ quality, params: Object.entries(actual).map(([code, v]) => ({ code, actual: v, capMin: P[code].capMin, capMax: P[code].capMax })) });
      const loss = out.result === "Pass" ? round(rnd(40, 100), 0) : round(rnd(160, 420), 0);
      day += Math.round(rnd(4, 10));
      const rid = (await ins(
        "insert into core.trial_run(launch_id,run_no,started_at,ended_at,status,result,result_notes,loss_kg,next_step) values ($1,$2,$3,$3,'Closed',$4,$5,$6,$7) returning id",
        [lid, run, new Date(created.getTime() + day * 86400000), out.result, JSON.stringify(out.notes), loss, out.result === "Pass" ? "TA" : "Repeat"],
      )).id;
      for (const [k, p] of Object.entries(P)) await c.query("insert into core.run_parameter values ($1,$2,$3,$3)", [rid, p.id, actual[k]]);
      for (const q of quality) await c.query("insert into core.run_quality(run_id,quality_test_def_id,value,spec_min,spec_max,pass) values ($1,$2,$3,$4,$5,true)", [rid, QT[q.code].id, q.value, q.specMin, q.specMax]);

      if (out.result !== "Pass") {
        const reasons = new Set<string>();
        for (const q of quality) {
          const off = (q.specMin !== null && q.value < q.specMin) || (q.specMax !== null && q.value > q.specMax);
          const span = q.specMin !== null && q.specMax !== null ? q.specMax - q.specMin : Math.abs(q.specMax ?? q.specMin ?? 0);
          const near = q.critical && ((q.specMin !== null && q.value - q.specMin < 0.05 * span) || (q.specMax !== null && q.specMax - q.value < 0.05 * span));
          if (off || near) reasons.add({ viscosity_cp: "viscosity_off", sediment_pct: "sedimentation", creaming_idx: "creaming", ph: "ph_off" }[q.code]!);
        }
        if (!reasons.size) reasons.add("equipment_issue");
        for (const rc of reasons) await c.query("insert into core.run_reason(run_id,reason_code) values ($1,$2)", [rid, rc]);
        // engineers learn from each run: deviations shrink
        for (const k of Object.keys(z)) z[k] = z[k] * 0.4 + gauss(r) * 0.3;
      } else {
        accepted = true;
        await c.query(
          "update core.launch_project set status='Closed', ta_decision='Accepted', ta_date=$2, ta_by=$3, closed_at=$4 where id=$1",
          [lid, new Date(created.getTime() + (day + 3) * 86400000).toISOString().slice(0, 10), users.qa, new Date(created.getTime() + (day + 3) * 86400000)],
        );
        launchCount++;
      }
    }
    if (!accepted) await c.query("update core.launch_project set status='Cancelled', cancel_reason='Stopped after repeated misses' where id=$1", [lid]);
  }

  // ---- one open launch ready for the live demo (high viscosity, high fat: triggers flags and rules)
  const dp = (await ins("insert into core.product(category_id,code,name,format) values ($1,'D-001','Choco Malt RTD 200ml (demo)','200ml carton') returning id", [cat])).id;
  const demo: Record<string, number | string> = { viscosity_cp: 38, fat_pct: 2.8, solids_pct: 15.5, ph: 6.7, pack_ml: 200 };
  for (const [k, v] of Object.entries(demo)) await c.query("insert into core.product_attribute_value(product_id,attribute_def_id,value_num) values ($1,$2,$3)", [dp, AT[k], v]);
  await c.query("insert into core.product_attribute_value(product_id,attribute_def_id,value_choice) values ($1,$2,'cocoa')", [dp, AT.base]);
  for (const [k, mn, mx] of [["viscosity_cp", 35, 41], ["sediment_pct", null, 0.5], ["creaming_idx", null, 1.6], ["ph", 6.5, 6.9]] as const)
    await c.query("insert into core.product_spec values ($1,$2,$3,$4)", [dp, QT[k].id, mn, mx]);
  await c.query("insert into core.launch_project(product_id,line_id,objective,status,created_by) values ($1,$2,'Demo launch: new choco malt RTD','Draft',$3)", [dp, lines[2].id, users.rd_engineer]);

  }
  console.log(DEMO ? `[seed] ${launchCount} accepted launches, 1 open demo launch` : "[seed] reference configuration only (no launches)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Synthetic, real-shaped market data for the demo. Deterministic. Everything is generated and labelled as sample data.
 *   npx tsx scripts/seed.ts --force        wipe and reseed
 *   npx tsx scripts/seed.ts --if-empty     seed only when the database has no users
 *   add --config-only for users, channels and settings without any prices
 * Planted events (relative to the newest date, D): a competitor price cut at modern trade (D-3), a promo wave on eCom (D-2),
 * a pack-size change (D-5), out-of-stock slots (D-4), a competitor price rise on eCom (D-2), and a widening shelf gap in general trade.
 */
import { Client } from "pg";
import { gauss, rng } from "../lib/rng";
import { renderShelf, type ShelfSpec } from "../lib/mockShelf";
import { createPhoto, checkItem, refreshRadar } from "../lib/radar";
import { q, q1, tx, qc } from "../lib/db";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const FORCE = args.includes("--force"), IF_EMPTY = args.includes("--if-empty"), CONFIG_ONLY = args.includes("--config-only");
const day = (d: Date) => d.toISOString().slice(0, 10);
const add = (d: string, n: number) => day(new Date(Date.parse(d + "T00:00:00Z") + n * 86400000));

const USERS = [
  ["Linh Tran (Sales lead)", "linh.tran@example.com", "sales_lead"], ["Minh Pham (Category manager)", "minh.pham@example.com", "category_manager"],
  ["An Nguyen (Field rep)", "an.nguyen@example.com", "field_rep"], ["Hoa Le (Analyst)", "hoa.le@example.com", "analyst"],
  ["Quang Vo (Admin)", "quang.vo@example.com", "admin"], ["Guest (read only)", "guest@example.com", "viewer"],
];
const SETTINGS: [string, number, number, number, string, string, string][] = [
  ["z_threshold", 3, 2, 6, "x", "Unusualness needed to flag a price change", "How many robust standard deviations from a retailer's own history. Higher flags fewer moves."],
  ["min_change_pct", 3, 1, 20, "%", "Smallest price change worth flagging", "Changes smaller than this are ignored even if unusual."],
  ["promo_depth_pct", 12, 5, 40, "%", "Promo depth that counts as a promo wave", "Discount a shopper gets after promo or voucher, against the shelf price."],
  ["shelf_gap_pct", 8, 3, 25, "%", "Shelf price gap that counts as a gap", "Our price above the competing product on the shelf."],
  ["oos_min_retailers", 3, 2, 10, "retailers", "Empty slots that count as an out-of-stock move", "Retailers showing our SKU out of stock in the last week."],
  ["diversion_rate", 0.3, 0.05, 0.8, "share", "Share of a price gap that moves demand", "Assumption. Ask category management to confirm for each category."],
  ["gross_margin", 0.32, 0.1, 0.6, "share", "Gross margin on Nestlé sales", "Used for the margin figure in scenarios. A placeholder until Finance confirms."],
  ["promo_depth_scenario_pct", 5, 2, 15, "%", "Depth of the targeted promo scenario", "Applied for two weeks in the retailers affected."],
  ["shelf_uplift_pct", 3, 1, 10, "%", "Volume uplift from a shelf action", "An assumption: there is little history for display actions."],
  ["default_elasticity", -1.4, -3, -0.5, "elasticity", "Price elasticity used when the data cannot give one", "Used when a SKU has too little price variation."],
  ["oos_loss_rate", 0.3, 0.1, 1, "share", "Share of demand lost while a slot is empty", "Assumption for the out-of-stock exposure."],
  ["level_high_vnd", 120000000, 10000000, 2000000000, "VND/week", "Exposure that makes a move High", "Weekly Nestlé revenue at risk."],
  ["level_medium_vnd", 40000000, 1000000, 1000000000, "VND/week", "Exposure that makes a move Medium", "Weekly Nestlé revenue at risk."],
];
// code, name, brand, nestle, category, pack_ml, pack_count, competes_with, base price, weekly revenue at MT (VND), true elasticity
const SKUS: [string, string, string, boolean, string, number, number, string | null, number, number, number][] = [
  ["N-UHT-1L", "UHT full cream milk 1 L", "Nestlé", true, "UHT milk", 1000, 1, null, 25400, 3_800_000_000, -1.6],
  ["N-UHT-180", "UHT milk 180 ml", "Nestlé", true, "UHT milk", 180, 1, null, 7800, 2_200_000_000, -1.3],
  ["N-RTD-180", "RTD chocolate milk 180 ml", "Nestlé", true, "RTD milk", 180, 1, null, 11500, 1_600_000_000, -2.0],
  ["N-YOG-4", "Drinking yoghurt 4-pack", "Nestlé", true, "Drinking yoghurt", 400, 4, null, 28000, 1_000_000_000, -1.8],
  ["A-UHT-1L", "UHT milk 1 L", "Competitor A", false, "UHT milk", 1000, 1, "N-UHT-1L", 24600, 0, 0],
  ["C-UHT-1L", "UHT milk 1 L", "Competitor C", false, "UHT milk", 1000, 1, "N-UHT-1L", 25000, 0, 0],
  ["A-UHT-180", "UHT milk 180 ml", "Competitor A", false, "UHT milk", 180, 1, "N-UHT-180", 7500, 0, 0],
  ["C-RTD-180", "RTD chocolate milk 180 ml", "Competitor C", false, "RTD milk", 180, 1, "N-RTD-180", 10900, 0, 0],
  ["B-YOG-4", "Drinking yoghurt 4-pack", "Competitor B", false, "Drinking yoghurt", 400, 4, "N-YOG-4", 26500, 0, 0],
];
const CHANNELS = [["GT", "General trade"], ["MT", "Modern trade"], ["ECOM", "eCom"]];
const RETAILERS: [string, string, string][] = [
  ...[1, 2, 3, 4].map((i) => [`MT-${i}`, `Modern trade chain ${i}`, "MT"] as [string, string, string]),
  ...[1, 2, 3].map((i) => [`EC-${i}`, `Marketplace ${i}`, "ECOM"] as [string, string, string]),
  ...[1, 2, 3, 4, 5, 6].map((i) => [`GT-${i}`, `Store ${i}`, "GT"] as [string, string, string]),
];
const CH_OFF: Record<string, number> = { GT: 1.02, MT: 1.0, ECOM: 0.97 };
const CH_REV: Record<string, number> = { GT: 0.7, MT: 1.0, ECOM: 0.25 };

async function bulk(client: Client, table: string, cols: [string, string][], rows: any[][]) {
  const spec = cols.map(([n, t]) => `${n} ${t}`).join(", ");
  for (let i = 0; i < rows.length; i += 1500) {
    const chunk = rows.slice(i, i + 1500).map((r) => Object.fromEntries(cols.map(([n], k) => [n, r[k]])));
    await client.query(`insert into ${table}(${cols.map((c) => c[0]).join(",")}) select * from jsonb_to_recordset($1::jsonb) as t(${spec})`, [JSON.stringify(chunk)]);
  }
}

async function main() {
  const url = process.env.DATABASE_URL; if (!url) throw new Error("DATABASE_URL is not set");
  const c = new Client({ connectionString: url }); await c.connect();
  if (IF_EMPTY && Number((await c.query("select count(*) from cfg.app_user")).rows[0].count) > 0) { console.log("[seed] database already has data, skipping"); await c.end(); return; }
  if (!FORCE && !IF_EMPTY && Number((await c.query("select count(*) from cfg.app_user")).rows[0].count) > 0) throw new Error("Database is not empty. Use --force to wipe and reseed");
  await c.query(`truncate audit.event, ai.call_log, mkt.decision, mkt.scenario, mkt.move, mkt.elasticity, mkt.photo_item, mkt.photo, mkt.brief, mkt.truth_event, mkt.observation, mkt.sales_weekly, mkt.feed_status, mkt.retailer, mkt.sku, cfg.setting, cfg.channel, cfg.app_user restart identity cascade`);
  await c.query(`alter sequence mkt.move_seq restart with 2001`);

  for (const [name, email, role] of USERS) await c.query(`insert into cfg.app_user(name,email,role) values ($1,$2,$3)`, [name, email, role]);
  for (const [k, v, lo, hi, unit, label, help] of SETTINGS) await c.query(`insert into cfg.setting(key,value,min_value,max_value,unit,label,help) values ($1,$2,$3,$4,$5,$6,$7)`, [k, v, lo, hi, unit, label, help]);
  for (const [code, name] of CHANNELS) await c.query(`insert into cfg.channel(code,name) values ($1,$2)`, [code, name]);
  const chId = Object.fromEntries((await c.query(`select id, code from cfg.channel`)).rows.map((r) => [r.code, r.id]));
  for (const [code, name, ch] of RETAILERS) await c.query(`insert into mkt.retailer(code,name,channel_id) values ($1,$2,$3)`, [code, name, chId[ch]]);
  const retId = Object.fromEntries((await c.query(`select id, code from mkt.retailer`)).rows.map((r) => [r.code, r.id]));
  for (const s of SKUS.filter((x) => x[3])) await c.query(`insert into mkt.sku(code,name,brand,is_nestle,category,pack_ml,pack_count) values ($1,$2,$3,$4,$5,$6,$7)`, [s[0], s[1], s[2], s[3], s[4], s[5], s[6]]);
  const nid = Object.fromEntries((await c.query(`select id, code from mkt.sku`)).rows.map((r) => [r.code, r.id]));
  for (const s of SKUS.filter((x) => !x[3])) await c.query(`insert into mkt.sku(code,name,brand,is_nestle,category,pack_ml,pack_count,competes_with) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [s[0], s[1], s[2], s[3], s[4], s[5], s[6], nid[s[7]!]]);
  const sid = Object.fromEntries((await c.query(`select id, code from mkt.sku`)).rows.map((r) => [r.code, r.id]));
  if (CONFIG_ONLY) { console.log("[seed] config only: done"); await c.end(); return; }

  // ---------------------------------------------------------------- dates
  const D = day(new Date());
  const dow = new Date(D + "T00:00:00Z").getUTCDay();
  const lastMonday = add(D, -((dow + 6) % 7));
  const R = rng(20261118);
  const obsRows: any[][] = [];
  const nestlePriceByChWk = new Map<string, number[]>(); // key sku|ch|week -> prices seen

  // channel-wide Nestlé promo weeks (these give the elasticity estimate something to learn from)
  const promoWeek = new Map<string, number>();
  for (const s of SKUS.filter((x) => x[3])) for (const ch of Object.keys(CH_OFF)) for (let k = 1; k <= 52; k++) if (R() < 0.16) promoWeek.set(`${s[0]}|${ch}|${k}`, 0.07 + R() * 0.07);
  // historical competitor events (also the ground truth for the backtest)
  const hist = [
    { kind: "price_cut", sku: "A-UHT-1L", ch: "MT", start: add(lastMonday, -7 * 17), weeks: 3, factor: 0.92, note: "Competitor A price cut, 3 weeks" },
    { kind: "promo", sku: "B-YOG-4", ch: "ECOM", start: add(lastMonday, -7 * 30), weeks: 2, factor: 0.85, note: "Competitor B promo, 2 weeks" },
  ];
  const inHist = (skuCode: string, ch: string, date: string) => hist.find((h) => h.sku === skuCode && h.ch === ch && date >= h.start && date < add(h.start, h.weeks * 7));

  const mk = (skuCode: string, retCode: string, ch: string, date: string, weekAgo: number, source: string) => {
    const s = SKUS.find((x) => x[0] === skuCode)!;
    const retOff = 1 + (((retCode.charCodeAt(retCode.length - 1) * 7919) % 31) - 15) / 1000; // +-1.5 %
    const season = 1 + 0.004 * Math.sin((2 * Math.PI * weekAgo) / 52);
    let price = s[8] * CH_OFF[ch] * retOff * season * (1 + 0.003 * gauss(R));
    let promoPrice: number | null = null, promoText: string | null = null, packMl: number | null = s[5], inStock = true, facings: number | null = 2 + Math.floor(R() * 3);
    if (s[3]) { const pw = promoWeek.get(`${skuCode}|${ch}|${weekAgo}`); if (pw) price *= 1 - pw; }
    else if (R() < 0.03 && weekAgo > 0) price *= 0.93;
    const h = inHist(skuCode, ch, date);
    if (h) { if (h.kind === "price_cut") price *= h.factor; else if (!retCode.endsWith("3")) { promoPrice = Math.round(price * h.factor); promoText = "promo"; } }
    // ---- planted, current events (daily rows in the last week)
    const ago = Math.round((Date.parse(D) - Date.parse(date)) / 86400000);
    if (skuCode === "A-UHT-1L" && ch === "MT" && ago <= 3 && !retCode.endsWith("4")) price *= 0.89;
    if (skuCode === "B-YOG-4" && ch === "ECOM" && ago <= 2) { if (retCode !== "EC-3") { promoPrice = Math.round(price * 0.82); promoText = "4-pack + voucher"; } else { promoPrice = Math.round(price * 0.96); promoText = "voucher"; } }
    if (skuCode === "A-UHT-180" && ch === "MT" && ago <= 5) packMl = 170;
    if (skuCode === "C-UHT-1L" && ch === "ECOM" && ago <= 2) price *= 1.06;
    if (skuCode === "N-YOG-4" && ch === "MT" && ago <= 4 && ["MT-1", "MT-2", "MT-3"].includes(retCode)) { inStock = false; facings = 0; }
    if (skuCode === "C-RTD-180" && ch === "GT" && date >= add(lastMonday, -14)) price = (s[8] - 400) * CH_OFF[ch] * retOff * season * (1 + 0.003 * gauss(R));
    price = Math.round(price / 100) * 100;
    if (promoPrice != null) promoPrice = Math.min(promoPrice, price);
    if (s[3]) { const k = `${skuCode}|${ch}|${weekAgo}`; (nestlePriceByChWk.get(k) ?? nestlePriceByChWk.set(k, []).get(k)!).push(promoPrice ?? price); }
    obsRows.push([sid[skuCode], retId[retCode], chId[ch], date, price, promoPrice, promoText, packMl, inStock, facings, source, null]);
  };

  const retsOf = (ch: string) => RETAILERS.filter((r) => r[2] === ch).map((r) => r[0]);
  for (const s of SKUS) for (const [rc, , ch] of RETAILERS) {
    const source = ch === "MT" ? "price_list" : "feed";
    for (let k = 1; k <= 52; k++) mk(s[0], rc, ch, add(lastMonday, -7 * k), k, source);
    if (ch === "GT") mk(s[0], rc, ch, lastMonday, 0, "feed");
    else for (let a = 6; a >= 0; a--) { const date = add(D, -a); mk(s[0], rc, ch, date, 0, source); }
  }
  void retsOf;
  const cols: [string, string][] = [["sku_id", "uuid"], ["retailer_id", "uuid"], ["channel_id", "uuid"], ["observed_on", "date"], ["price", "numeric"], ["promo_price", "numeric"], ["promo_text", "text"], ["pack_ml", "int"], ["in_stock", "boolean"], ["facings", "int"], ["source", "text"], ["source_ref", "text"]];
  // a retailer's weekly row for the current week would collide with its daily row: keep one per sku, retailer, date, source
  const seen = new Set<string>(); const uniq = obsRows.filter((r) => { const k = `${r[0]}|${r[1]}|${r[3]}|${r[10]}`; if (seen.has(k)) return false; seen.add(k); return true; });
  await bulk(c, "mkt.observation", cols, uniq);

  // ---------------------------------------------------------------- Nestlé sales, weekly, up to the last full week
  const salesRows: any[][] = [];
  for (const s of SKUS.filter((x) => x[3])) for (const ch of Object.keys(CH_OFF)) for (let k = 52; k >= 1; k--) {
    const ps = nestlePriceByChWk.get(`${s[0]}|${ch}|${k}`); if (!ps?.length) continue;
    const p = ps.reduce((a, b) => a + b, 0) / ps.length;
    const base = s[8] * CH_OFF[ch];
    const eps = s[10] * (ch === "ECOM" ? 1.2 : 1);
    const baseUnits = (s[9] * CH_REV[ch]) / base;
    let units = baseUnits * Math.pow(p / base, eps) * (1 + 0.08 * Math.sin((2 * Math.PI * k) / 52)) * (1 + 0.03 * gauss(R));
    const h = hist.find((x) => x.sku === (s[0] === "N-UHT-1L" ? "A-UHT-1L" : "") && x.ch === ch && add(lastMonday, -7 * k) >= x.start && add(lastMonday, -7 * k) < add(x.start, x.weeks * 7));
    if (h) units *= 1 - 0.3 * Math.abs(eps) * 0.08;
    units = Math.max(1, Math.round(units));
    salesRows.push([sid[s[0]], chId[ch], add(lastMonday, -7 * k), units, Math.round(units * p)]);
  }
  await bulk(c, "mkt.sales_weekly", [["sku_id", "uuid"], ["channel_id", "uuid"], ["week_start", "date"], ["units", "numeric"], ["revenue_vnd", "numeric"]], salesRows);

  // ---------------------------------------------------------------- ground truth for the backtest (synthetic only)
  const truth = [
    ...hist.map((h) => [h.kind, h.sku, h.ch, h.start, h.note]),
    ["price_cut", "A-UHT-1L", "MT", add(D, -3), "Planted: Competitor A price cut at 3 of 4 chains"],
    ["promo", "B-YOG-4", "ECOM", add(D, -2), "Planted: promo and voucher wave on 2 marketplaces"],
    ["pack_change", "A-UHT-180", "MT", add(D, -5), "Planted: pack 180 ml to 170 ml, same price"],
    ["out_of_stock", "N-YOG-4", "MT", add(D, -4), "Planted: empty slots at 3 chains"],
    ["price_rise", "C-UHT-1L", "ECOM", add(D, -2), "Planted: Competitor C price rise"],
    ["price_cut", "C-RTD-180", "GT", add(lastMonday, -14), "Planted: Competitor C cut in general trade, widening our shelf gap"],
  ];
  for (const t of truth) await c.query(`insert into mkt.truth_event(kind,sku_id,channel_id,started_on,note) values ($1,$2,$3,$4,$5)`, [t[0], sid[t[1]], chId[t[2]], t[3], t[4]]);

  const nObs = (await c.query(`select count(*) from mkt.observation`)).rows[0].count;
  await c.query(`insert into mkt.feed_status(name,kind,last_run,rows_added,note) values
    ('eCom prices and promos','feed',now(),$1,'Synthetic collector'),('Modern trade price lists','price_list',now(),$1,'Synthetic collector'),
    ('General trade shelf audit','feed',now() - interval '3 days',$1,'Weekly, synthetic'),('Nestlé sales','sales',now() - interval '4 hours',$2,'Synthetic weekly sales')`, [Math.round(Number(nObs) / 3), salesRows.length]);
  await c.end();

  // ---------------------------------------------------------------- app layer: moves and scenarios, mock photos
  const analyst = (await q1<{ id: string }>(`select id from cfg.app_user where role='analyst'`))!.id;
  const rep = (await q1<{ id: string }>(`select id from cfg.app_user where role='field_rep'`))!.id;
  const r = await refreshRadar(analyst);
  console.log(`[seed] ${nObs} observations, ${salesRows.length} weekly sales rows, ${r.created} moves detected as of ${r.asOf}`);

  const gtPrice = async (code: string, store: string) => Number((await q1<{ p: string }>(`select price as p from mkt.observation o where o.sku_id=$1 and o.retailer_id=$2 order by observed_on desc limit 1`, [sid[code], retId[store]]))!.p);
  type Item = { label: string; code: string | null; color: string; price: number | null; covered?: boolean; empty?: boolean };
  const photo = async (store: string, date: string, rows: Item[][], pre: (item: Item, idx: number) => any) => {
    const spec: ShelfSpec = { store: RETAILERS.find((x) => x[0] === store)![1], date, rows: rows.map((row) => row.map((i) => ({ label: i.label, color: i.color, price: i.price, covered: i.covered, empty: i.empty }))) };
    const bytes = await renderShelf(spec);
    const id = await createPhoto(rep, { retailerId: retId[store], takenOn: date, bytes, mime: "image/png", isMock: true });
    let idx = 0; const items: string[] = [];
    for (const row of rows) for (const it of row) {
      const ai = pre(it, idx);
      const ins = await q1<{ id: string }>(`insert into mkt.photo_item(photo_id,idx,label,sku_id,ai_price,ai_facings,ai_conf,ai_note,needs_check) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [id, idx, it.label, it.code ? sid[it.code] : null, ai.price, ai.facings, ai.conf, ai.note, ai.conf < 0.8 || ai.price == null]);
      items.push(ins!.id); idx++;
    }
    return { id, items };
  };
  const reading = (it: Item) => it.covered ? { price: null, facings: 1, conf: 0.5, note: "Tag partly covered, not guessed" } : it.empty ? { price: it.price, facings: 0, conf: 0.82, note: "Empty slot, out of stock" } : { price: it.price, facings: 2, conf: 0.93, note: "Tag clear" };
  const P = { n: await gtPrice("N-RTD-180", "GT-3"), c: await gtPrice("C-RTD-180", "GT-3"), y: await gtPrice("N-YOG-4", "GT-3"), u: await gtPrice("N-UHT-1L", "GT-3") };
  await photo("GT-3", add(D, -1), [
    [{ label: "Our RTD choc 180 ml", code: "N-RTD-180", color: "#7a4a2b", price: P.n }, { label: "Competitor C RTD 180 ml", code: "C-RTD-180", color: "#2b6fb5", price: P.c }, { label: "Competitor C RTD 180 ml", code: "C-RTD-180", color: "#2b6fb5", price: P.c }],
    [{ label: "Our UHT 1 L", code: "N-UHT-1L", color: "#0b6e4f", price: P.u }, { label: "Our drinking yoghurt x4", code: "N-YOG-4", color: "#0072a8", price: P.y, covered: true }, { label: "", code: "N-YOG-4", color: "#999", price: P.y, empty: true }],
  ], reading);
  await photo("GT-5", add(D, -1), [
    [{ label: "Our RTD choc 180 ml", code: "N-RTD-180", color: "#7a4a2b", price: await gtPrice("N-RTD-180", "GT-5") }, { label: "Competitor C RTD 180 ml", code: "C-RTD-180", color: "#2b6fb5", price: await gtPrice("C-RTD-180", "GT-5") }],
    [{ label: "Our UHT 1 L", code: "N-UHT-1L", color: "#0b6e4f", price: await gtPrice("N-UHT-1L", "GT-5") }],
  ], reading);
  const old = await photo("GT-2", add(D, -8), [[{ label: "Our RTD choc 180 ml", code: "N-RTD-180", color: "#7a4a2b", price: await gtPrice("N-RTD-180", "GT-2") }, { label: "Competitor C RTD 180 ml", code: "C-RTD-180", color: "#2b6fb5", price: await gtPrice("C-RTD-180", "GT-2") }]], reading);
  for (const id of old.items) await checkItem(rep, id, { action: "confirm" });
  const hash = createHash("sha256").update("seed").digest("hex").slice(0, 8);
  console.log(`[seed] 3 mock shelf photos (${hash}), 1 already confirmed. done`);
  void tx; void qc; void q;
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

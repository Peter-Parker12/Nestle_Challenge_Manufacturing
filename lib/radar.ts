import { createHash } from "node:crypto";
import { HttpError } from "./auth";
import { q, q1, qc, tx } from "./db";
import { detectMoves } from "./engine/detect";
import { estimateElasticity } from "./engine/elasticity";
import { buildScenarios } from "./engine/scenario";
import { DEFAULT_SETTINGS, ENGINE_VERSION, addDays, median, round, type Elast, type Obs, type Sales, type Settings, type Sku } from "./engine/types";

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// ------------------------------------------------------------------ settings
export async function getSettingRows() { return q(`select s.*, u.name as updated_by_name from cfg.setting s left join cfg.app_user u on u.id=s.updated_by order by s.key`); }
export async function getSettings(): Promise<Settings> {
  const rows = await q<{ key: string; value: string }>(`select key, value from cfg.setting`);
  const s: any = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in s) s[r.key] = Number(r.value);
  return s;
}
export async function saveSetting(userId: string, key: string, value: number, reason: string) {
  if (reason.trim().length < 5) throw new HttpError(422, "Say why the setting changes (at least 5 characters)", "validation");
  const row = await q1<{ min_value: string; max_value: string }>(`select min_value, max_value from cfg.setting where key=$1`, [key]);
  if (!row) throw new HttpError(404, "Unknown setting", "not_found");
  if (!Number.isFinite(value) || value < Number(row.min_value) || value > Number(row.max_value)) throw new HttpError(422, `The value must be between ${row.min_value} and ${row.max_value}`, "validation");
  await tx({ userId, reason }, (c) => qc(c, `update cfg.setting set value=$2, updated_by=$3, updated_at=now() where key=$1`, [key, value, userId]));
}

// ------------------------------------------------------------------ world
export async function latestDate(): Promise<string | null> {
  return (await q1<{ d: string }>(`select max(observed_on) as d from mkt.observation`))?.d ?? null;
}

export async function loadWorld(asOf: string) {
  const skusR = await q(`select id, code, name, brand, is_nestle, pack_ml, competes_with from mkt.sku where status='Active'`);
  const skus: Sku[] = skusR.map((s) => ({ id: s.id, code: s.code, name: s.name, brand: s.brand, isNestle: s.is_nestle, packMl: s.pack_ml, competesWith: s.competes_with }));
  const obsR = await q(`select id, sku_id, retailer_id, channel_id, observed_on, price, promo_price, promo_text, pack_ml, in_stock, facings, source from mkt.observation where observed_on between $1::date - 100 and $1::date order by observed_on, id`, [asOf]);
  const obs: Obs[] = obsR.map((o) => ({ id: Number(o.id), skuId: o.sku_id, retailerId: o.retailer_id, channelId: o.channel_id, on: o.observed_on, price: Number(o.price), promoPrice: num(o.promo_price), promoText: o.promo_text, packMl: o.pack_ml, inStock: o.in_stock, facings: o.facings, source: o.source }));
  const salesR = await q(`select sku_id, channel_id, week_start, units, revenue_vnd from mkt.sales_weekly where week_start <= $1::date order by week_start`, [asOf]);
  const sales: Sales[] = salesR.map((s) => ({ skuId: s.sku_id, channelId: s.channel_id, weekStart: s.week_start, units: Number(s.units), revenue: Number(s.revenue_vnd) }));
  const chs = await q(`select c.id, c.name, (select count(*)::int from mkt.retailer r where r.channel_id=c.id) as n from cfg.channel c order by c.code`);
  return {
    skus, obs, sales,
    retailersPerChannel: Object.fromEntries(chs.map((c) => [c.id, c.n as number])) as Record<string, number>,
    channelName: Object.fromEntries(chs.map((c) => [c.id, c.name as string])) as Record<string, string>,
  };
}

export async function computeElasticities(asOf: string, settings: Settings, persist: boolean) {
  const rows = await q(`select sku_id, channel_id, week_start, units, revenue_vnd from mkt.sales_weekly where week_start <= $1::date order by week_start`, [asOf]);
  const groups = new Map<string, Sales[]>();
  for (const r of rows) {
    const k = `${r.sku_id}|${r.channel_id}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push({ skuId: r.sku_id, channelId: r.channel_id, weekStart: r.week_start, units: Number(r.units), revenue: Number(r.revenue_vnd) });
  }
  const out = new Map<string, Elast & { r2?: number }>();
  for (const [k, v] of groups) out.set(k, estimateElasticity(v, settings.default_elasticity));
  if (persist) {
    for (const [k, e] of out) {
      const [sku, ch] = k.split("|");
      await q(`insert into mkt.elasticity(sku_id,channel_id,value,low,high,n_points,r2,method,computed_on) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               on conflict (sku_id,channel_id,computed_on) do nothing`, [sku, ch, e.value, e.low, e.high, e.n, (e as any).r2 ?? null, e.method, asOf]);
    }
  }
  return out;
}

// ------------------------------------------------------------------ refresh: detect, size, build scenarios
export async function refreshRadar(userId: string | null) {
  const asOf = await latestDate();
  if (!asOf) throw new HttpError(409, "There is no price data yet. Load prices first", "conflict");
  const settings = await getSettings();
  const world = await loadWorld(asOf);
  const el = await computeElasticities(asOf, settings, true);
  const elasticity = (sku: string, ch: string): Elast => el.get(`${sku}|${ch}`) ?? { value: settings.default_elasticity, low: settings.default_elasticity * 1.35, high: settings.default_elasticity * 0.65, method: "default", n: 0 };
  const moves = detectMoves({ asOf, ...world, settings, elasticity });
  let created = 0, existing = 0;
  await tx({ userId, reason: "Daily radar refresh" }, async (c) => {
    for (const m of moves) {
      const dup = await qc(c, `select id from mkt.move where kind=$1 and sku_id=$2 and channel_id=$3 and detected_on >= $4::date - 7`, [m.kind, m.skuId, m.channelId, asOf]);
      if (dup.length) { existing++; continue; }
      const row = (await qc(c, `insert into mkt.move(detected_on,kind,sku_id,nestle_sku_id,channel_id,title,baseline,observed,change_pct,z,coverage,exposure_vnd,exposure_low,exposure_high,level,evidence,engine_version)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
        [asOf, m.kind, m.skuId, m.nestleSkuId, m.channelId, m.title, m.baseline, m.observed, m.changePct, m.z, m.coverage, Math.round(m.exposure), Math.round(m.exposureLow), Math.round(m.exposureHigh), m.level, JSON.stringify(m.evidence), ENGINE_VERSION]))[0];
      for (const s of buildScenarios(m, elasticity(m.nestleSkuId, m.channelId), settings, world.retailersPerChannel[m.channelId])) {
        await qc(c, `insert into mkt.scenario(move_id,label,kind,title,volume_pct,volume_low,volume_high,margin_vnd_wk,cost_text,risk_text,confidence,needs_category_manager,assumptions,engine_version)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [row.id, s.label, s.kind, s.title, s.volumePct, s.volumeLow, s.volumeHigh, s.marginVnd, s.costText, s.riskText, s.confidence, s.needsCategoryManager, JSON.stringify(s.assumptions), ENGINE_VERSION]);
      }
      created++;
    }
  });
  return { asOf, created, existing, detected: moves.length, engine: ENGINE_VERSION };
}

// ------------------------------------------------------------------ reading moves
const MOVE_SELECT = `
  select m.*, s.code as sku_code, s.name as sku_name, s.brand, n.name as nestle_name, n.code as nestle_code, c.code as channel_code, c.name as channel_name,
         d.action as decision, d.reason as decision_reason, d.defer_until, d.decided_at, du.name as decided_by_name, sc.label as decision_label, sc.title as decision_title,
         (select count(*)::int from mkt.scenario x where x.move_id=m.id) as n_scenarios
  from mkt.move m join mkt.sku s on s.id=m.sku_id join mkt.sku n on n.id=m.nestle_sku_id join cfg.channel c on c.id=m.channel_id
  left join lateral (select * from mkt.decision d where d.move_id=m.id order by d.decided_at desc limit 1) d on true
  left join cfg.app_user du on du.id=d.decided_by left join mkt.scenario sc on sc.id=d.scenario_id`;

export async function listMoves(opts: { channel?: string; sinceDays?: number } = {}) {
  const rows = await q(`${MOVE_SELECT} where m.detected_on >= $1::date - $2::int and ($3::text is null or c.code = $3) order by m.exposure_vnd desc`,
    [(await latestDate()) ?? new Date().toISOString().slice(0, 10), opts.sinceDays ?? 14, opts.channel ?? null]);
  return rows.map((r) => ({ ...r, exposure_vnd: Number(r.exposure_vnd), exposure_low: Number(r.exposure_low), exposure_high: Number(r.exposure_high), status: statusOf(r) }));
}
function statusOf(r: any) {
  if (r.decision === "Accepted") return "Accepted";
  if (r.decision === "Rejected") return "Rejected";
  if (r.decision === "Deferred") return r.defer_until && r.defer_until > new Date().toISOString().slice(0, 10) ? "Deferred" : "Open";
  return "Open";
}

export async function getMove(code: string) {
  const m = await q1(`${MOVE_SELECT} where m.code=$1`, [code]);
  if (!m) throw new HttpError(404, "Move not found", "not_found");
  const scenarios = await q(`select * from mkt.scenario where move_id=$1 order by label`, [m.id]);
  const decisions = await q(`select d.*, u.name as by_name, s.label from mkt.decision d join cfg.app_user u on u.id=d.decided_by join mkt.scenario s on s.id=d.scenario_id where d.move_id=$1 order by d.decided_at desc`, [m.id]);
  const asOf = m.detected_on as string;
  // price series: weekly median shelf price of the moved SKU and of the Nestlé SKU in this channel (last 15 weeks), plus the usual range
  const series = await q(
    `select d.wk::date as week, (select percentile_cont(0.5) within group (order by o.price) from mkt.observation o where o.sku_id=$1 and o.channel_id=$3 and o.observed_on between d.wk::date and d.wk::date + 6) as moved,
            (select percentile_cont(0.5) within group (order by o.price) from mkt.observation o where o.sku_id=$2 and o.channel_id=$3 and o.observed_on between d.wk::date and d.wk::date + 6) as ours
     from generate_series($4::date - 98, $4::date, interval '7 days') as d(wk) order by 1`, [m.sku_id, m.nestle_sku_id, m.channel_id, asOf]);
  const prior = series.slice(0, -2).map((s) => num(s.moved)).filter((v): v is number => v != null).slice(-8);
  const med = prior.length ? median(prior) : null;
  const mad = prior.length ? median(prior.map((v) => Math.abs(v - (med as number)))) : null;
  const evidence = await Promise.all((m.evidence as any[]).map(async (e) => {
    if (!e.obsId) return e;
    const o = await q1(`select o.id, o.observed_on, r.name as retailer, o.price, o.promo_price, o.source from mkt.observation o join mkt.retailer r on r.id=o.retailer_id where o.id=$1`, [e.obsId]);
    return { ...e, obs: o };
  }));
  const vol = await q1(
    `select (select sum(units) from mkt.sales_weekly where sku_id=$1 and channel_id=$2 and week_start = (select max(week_start) from mkt.sales_weekly where sku_id=$1 and channel_id=$2 and week_start <= $3::date - 7)) as last_week,
            (select avg(units) from (select units from mkt.sales_weekly where sku_id=$1 and channel_id=$2 and week_start <= $3::date - 14 order by week_start desc limit 8) z) as usual`, [m.nestle_sku_id, m.channel_id, asOf]);
  const el = await q1(`select * from mkt.elasticity where sku_id=$1 and channel_id=$2 order by computed_on desc limit 1`, [m.nestle_sku_id, m.channel_id]);
  const ourPrice = series.length ? num(series[series.length - 1].ours) : null;
  return {
    move: { ...m, status: statusOf(m), exposure_vnd: Number(m.exposure_vnd), exposure_low: Number(m.exposure_low), exposure_high: Number(m.exposure_high) },
    scenarios: scenarios.map((s) => ({ ...s, volume_pct: Number(s.volume_pct), volume_low: Number(s.volume_low), volume_high: Number(s.volume_high), margin_vnd_wk: Number(s.margin_vnd_wk) })),
    decisions, evidence,
    chart: { series: series.map((s) => ({ week: s.week, moved: num(s.moved), ours: num(s.ours) })), usualLow: med == null ? null : med - 1.5 * 1.4826 * (mad as number), usualHigh: med == null ? null : med + 1.5 * 1.4826 * (mad as number), median: med },
    volume: { lastWeek: num(vol?.last_week), usual: num(vol?.usual), changePct: vol?.usual ? round((Number(vol.last_week) / Number(vol.usual) - 1) * 100, 1) : null },
    elasticity: el ? { value: Number(el.value), low: Number(el.low), high: Number(el.high), method: el.method, n: el.n_points } : null,
    gapToUs: ourPrice && series.length && num(series[series.length - 1].moved) ? round((num(series[series.length - 1].moved)! / ourPrice - 1) * 100, 1) : null,
  };
}

export async function decide(userId: string, code: string, d: { label: string; action: "Accepted" | "Rejected" | "Deferred"; reason?: string; deferUntil?: string }) {
  const m = await q1<{ id: string }>(`select id from mkt.move where code=$1`, [code]);
  if (!m) throw new HttpError(404, "Move not found", "not_found");
  const sc = await q1<{ id: string }>(`select id from mkt.scenario where move_id=$1 and label=$2`, [m.id, d.label]);
  if (!sc) throw new HttpError(404, "Scenario not found", "not_found");
  await tx({ userId, reason: d.reason ?? `Scenario ${d.label} ${d.action.toLowerCase()}` }, (c) =>
    qc(c, `insert into mkt.decision(move_id,scenario_id,action,reason,defer_until,decided_by) values ($1,$2,$3,$4,$5,$6)`, [m.id, sc.id, d.action, d.reason ?? null, d.deferUntil ?? null, userId]));
}

// ------------------------------------------------------------------ overview figures
export async function overview() {
  const asOf = await latestDate();
  const moves = await listMoves({});
  const open = moves.filter((m) => m.status === "Open");
  const counts = { High: 0, Medium: 0, Low: 0 } as Record<string, number>;
  moves.forEach((m) => counts[m.level]++);
  const pending = (await q1<{ n: number }>(`select count(*)::int as n from mkt.photo_item where status='Pending' and needs_check`))?.n ?? 0;
  const pendingAll = (await q1<{ n: number }>(`select count(*)::int as n from mkt.photo_item where status='Pending'`))?.n ?? 0;
  const waiting = open.filter((m) => m.level !== "Low").length;
  const exposure = moves.filter((m) => m.kind !== "price_rise").reduce((s, m) => s + m.exposure_vnd, 0);
  const feeds = await q(`select * from mkt.feed_status order by name`);
  // price index by channel: average competitor price per ml relative to the Nestlé SKU it competes with (Nestlé = 100)
  const idx = asOf ? await q(
    `with last as (select o.sku_id, o.channel_id, percentile_cont(0.5) within group (order by o.price) as p from mkt.observation o where o.observed_on > $1::date - 14 group by 1,2)
     select c.code, c.name, round(100 * avg((l.p / s.pack_ml) / (ln.p / n.pack_ml))::numeric, 0) as idx
     from last l join mkt.sku s on s.id=l.sku_id and not s.is_nestle join mkt.sku n on n.id=s.competes_with
     join last ln on ln.sku_id=n.id and ln.channel_id=l.channel_id join cfg.channel c on c.id=l.channel_id group by 1,2 order by 1`, [asOf]) : [];
  const newest = await q1(`select * from mkt.brief order by brief_date desc, created_at desc limit 1`);
  return { asOf, moves, counts, waiting, exposure, pendingChecks: pending, pendingAll, feeds, priceIndex: idx, brief: newest };
}

export async function setupLists() {
  const skus = await q(`select s.*, n.name as vs from mkt.sku s left join mkt.sku n on n.id=s.competes_with order by s.is_nestle desc, s.code`);
  const retailers = await q(`select r.*, c.code as channel_code from mkt.retailer r join cfg.channel c on c.id=r.channel_id order by c.code, r.code`);
  const channels = await q(`select * from cfg.channel order by code`);
  return { skus, retailers, channels };
}

// ------------------------------------------------------------------ backtest on synthetic ground truth
export async function backtest() {
  const truth = await q(`select t.*, s.name as sku_name, c.name as channel_name from mkt.truth_event t join mkt.sku s on s.id=t.sku_id join cfg.channel c on c.id=t.channel_id order by t.started_on`);
  if (!truth.length) return { events: [], caught: 0, total: 0, note: "No ground-truth events (the demo seed creates them)." };
  const settings = await getSettings();
  const asOfNow = (await latestDate())!;
  const el = await computeElasticities(asOfNow, settings, false);
  const elasticity = (sku: string, ch: string): Elast => el.get(`${sku}|${ch}`) ?? { value: settings.default_elasticity, low: settings.default_elasticity * 1.35, high: settings.default_elasticity * 0.65, method: "default", n: 0 };
  const events: any[] = [];
  for (const t of truth) {
    // replay: look at the data as it stood at several days after the event began and see when it is first flagged
    let first: number | null = null;
    for (const lag of [0, 2, 4, 7, 10, 14]) {
      const asOf = addDays(t.started_on, lag);
      if (asOf > asOfNow) break;
      const world = await loadWorld(asOf);
      const moves = detectMoves({ asOf, ...world, settings, elasticity });
      const kinds = t.kind === "price_cut" ? ["price_cut", "shelf_gap"] : t.kind === "promo" ? ["promo"] : t.kind === "pack_change" ? ["pack_change"] : t.kind === "out_of_stock" ? ["out_of_stock"] : [t.kind];
      if (moves.some((m) => (m.skuId === t.sku_id || m.nestleSkuId === t.sku_id) && m.channelId === t.channel_id && kinds.includes(m.kind))) { first = lag; break; }
    }
    events.push({ kind: t.kind, sku: t.sku_name, channel: t.channel_name, started_on: t.started_on, note: t.note, caught: first != null, days_to_flag: first });
  }
  const caught = events.filter((e) => e.caught).length;
  const lags = events.filter((e) => e.caught).map((e) => e.days_to_flag as number);
  return { events, caught, total: events.length, medianDaysToFlag: lags.length ? median(lags) : null, note: "Synthetic data: the events were planted by the seed, so this checks that the detector works, not how it performs on the real market." };
}

// ------------------------------------------------------------------ photos
export async function createPhoto(userId: string | null, d: { retailerId: string; takenOn: string; bytes: Buffer; mime: string; isMock?: boolean }) {
  if (!["image/png", "image/jpeg"].includes(d.mime)) throw new HttpError(422, "Only PNG or JPEG photos are accepted", "validation");
  if (d.bytes.length > 5 * 1024 * 1024) throw new HttpError(422, "The photo is larger than 5 MB", "validation");
  const sha = createHash("sha256").update(d.bytes).digest("hex");
  const dup = await q1<{ id: string }>(`select id from mkt.photo where sha256=$1`, [sha]);
  if (dup) throw new HttpError(409, "This photo is already in the system", "conflict");
  return (await tx({ userId, reason: "Shelf photo upload" }, async (c) =>
    (await qc(c, `insert into mkt.photo(sha256,mime,bytes,retailer_id,taken_on,is_mock,uploaded_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [sha, d.mime, d.bytes, d.retailerId, d.takenOn, !!d.isMock, userId]))[0])).id as string;
}

export async function listPhotos() {
  return q(`select p.id, p.taken_on, p.is_mock, p.created_at, r.name as retailer, c.code as channel_code,
      (select count(*)::int from mkt.photo_item i where i.photo_id=p.id) as items,
      (select count(*)::int from mkt.photo_item i where i.photo_id=p.id and i.status='Pending') as pending
    from mkt.photo p join mkt.retailer r on r.id=p.retailer_id join cfg.channel c on c.id=r.channel_id order by p.taken_on desc, p.created_at desc limit 40`);
}
export async function getPhoto(id: string) {
  const p = await q1(`select p.id, p.taken_on, p.is_mock, p.mime, r.name as retailer, p.retailer_id from mkt.photo p join mkt.retailer r on r.id=p.retailer_id where p.id=$1`, [id]);
  if (!p) throw new HttpError(404, "Photo not found", "not_found");
  const items = await q(`select i.*, s.name as sku_name, s.code as sku_code, u.name as checked_by_name from mkt.photo_item i left join mkt.sku s on s.id=i.sku_id left join cfg.app_user u on u.id=i.checked_by where i.photo_id=$1 order by i.idx`, [id]);
  return { photo: p, items: items.map((i) => ({ ...i, ai_price: num(i.ai_price), ai_conf: Number(i.ai_conf), human_price: num(i.human_price) })) };
}
export async function photoBytes(id: string) {
  const p = await q1<{ bytes: Buffer; mime: string }>(`select bytes, mime from mkt.photo where id=$1`, [id]);
  if (!p) throw new HttpError(404, "Photo not found", "not_found");
  return p;
}

/** A person checks one reading. Confirm or correct adds a price observation (the AI reading stays beside it); unreadable adds nothing. */
export async function checkItem(userId: string, itemId: string, d: { action: "confirm" | "correct" | "unreadable"; price?: number; facings?: number; reason?: string }) {
  await tx({ userId, reason: d.reason ?? `Reading ${d.action}` }, async (c) => {
    const it = (await qc(c, `select i.*, p.taken_on, p.retailer_id, r.channel_id from mkt.photo_item i join mkt.photo p on p.id=i.photo_id join mkt.retailer r on r.id=p.retailer_id where i.id=$1 for update`, [itemId]))[0];
    if (!it) throw new HttpError(404, "Reading not found", "not_found");
    const status = d.action === "confirm" ? "Confirmed" : d.action === "correct" ? "Corrected" : "Unreadable";
    const price = d.action === "confirm" ? num(it.ai_price) : d.action === "correct" ? d.price ?? null : null;
    const facings = d.action === "confirm" ? it.ai_facings : d.action === "correct" ? d.facings ?? it.ai_facings : null;
    let obsId: number | null = null;
    if (status !== "Unreadable") {
      if (!it.sku_id) throw new HttpError(422, "This tag is not matched to a product. Mark it unreadable, or correct it after matching", "validation");
      if (price == null || price <= 0) throw new HttpError(422, "A price is needed", "validation");
      const ins = await qc(c, `insert into mkt.observation(sku_id,retailer_id,channel_id,observed_on,price,in_stock,facings,source,source_ref) values ($1,$2,$3,$4,$5,$6,$7,'shelf_photo',$8)
        on conflict (sku_id,retailer_id,observed_on,source) do nothing returning id`, [it.sku_id, it.retailer_id, it.channel_id, it.taken_on, price, facings !== 0, facings, `photo:${it.photo_id}`]);
      obsId = Number(ins.length ? ins[0].id : (await qc(c, `select id from mkt.observation where sku_id=$1 and retailer_id=$2 and observed_on=$3 and source='shelf_photo'`, [it.sku_id, it.retailer_id, it.taken_on]))[0].id);
    }
    await qc(c, `update mkt.photo_item set status=$2, human_price=$3, human_facings=$4, reason=$5, checked_by=$6, checked_at=now(), observation_id=$7 where id=$1`,
      [itemId, status, d.action === "correct" ? price : null, d.action === "correct" ? facings : null, d.reason ?? null, userId, obsId]);
  });
}

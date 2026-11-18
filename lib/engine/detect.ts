import { ENGINE_VERSION, addDays, mad, median, round, type Elast, type Level, type Move, type MoveKind, type Obs, type Sales, type Settings, type Sku } from "./types";

/**
 * Move detection. Rule-based and explainable: each retailer's price is compared with that retailer's own history
 * (median and median absolute deviation over the 8 weeks before the last week). A move is reported when the typical
 * retailer shows a big enough change and it is statistically unusual for that retailer. Exposure is the Nestlé revenue
 * at risk per week, sized from sales, the diversion rate and the price elasticity, with a range from the elasticity interval.
 */
export type DetectInput = {
  asOf: string; skus: Sku[]; obs: Obs[]; sales: Sales[]; retailersPerChannel: Record<string, number>; channelName: Record<string, string>;
  settings: Settings; elasticity: (skuId: string, channelId: string) => Elast;
};

const effective = (o: Obs) => o.promoPrice ?? o.price;
const pct = (v: number) => `${Math.abs(round(v * 100, 1))}%`;

function revenueWeek(sales: Sales[], skuId: string, channelId: string, asOf: string): number {
  const rows = sales.filter((s) => s.skuId === skuId && s.channelId === channelId && s.weekStart <= addDays(asOf, -7)).sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, 4);
  return rows.length ? rows.reduce((s, r) => s + r.revenue, 0) / rows.length : 0;
}

function levelOf(exposure: number, s: Settings, cap?: Level): Level {
  const l: Level = exposure >= s.level_high_vnd ? "High" : exposure >= s.level_medium_vnd ? "Medium" : "Low";
  if (cap === "Medium" && l === "High") return "Medium";
  if (cap === "Low") return "Low";
  return l;
}

/** Share of demand that moves to a competitor: diversion x |elasticity| x relative price gap change x coverage. */
export function exposureFromGap(rev: number, delta: number, coverage: number, e: Elast, s: Settings) {
  const f = (el: number) => rev * s.diversion_rate * Math.abs(el) * delta * coverage;
  return { mid: f(e.value), low: f(e.high), high: f(e.low) };
}

export function detectMoves(inp: DetectInput): Move[] {
  const { asOf, skus, obs, sales, settings: S } = inp;
  const out: Move[] = [];
  const skuBy = new Map(skus.map((s) => [s.id, s]));
  const recentFrom = addDays(asOf, -2);             // the last three days
  const baseFrom = addDays(asOf, -63), baseTo = addDays(asOf, -8);
  const channels = Object.keys(inp.retailersPerChannel);

  for (const sku of skus) {
    for (const ch of channels) {
      const mine = obs.filter((o) => o.skuId === sku.id && o.channelId === ch && o.on <= asOf);
      if (!mine.length) continue;
      const nestleId = sku.isNestle ? sku.id : sku.competesWith!;
      const rev = revenueWeek(sales, nestleId, ch, asOf);
      const recent = mine.filter((o) => o.on >= recentFrom);
      const base = mine.filter((o) => o.on >= baseFrom && o.on <= baseTo);
      const nRet = inp.retailersPerChannel[ch];
      const e = inp.elasticity(nestleId, ch);
      const retailers = [...new Set(recent.map((o) => o.retailerId))];

      if (!sku.isNestle && recent.length && base.length) {
        // ---- price change per retailer vs its own history
        const per = retailers.map((r) => {
          const b = base.filter((o) => o.retailerId === r).map((o) => o.price);
          const cur = recent.filter((o) => o.retailerId === r);
          if (b.length < 4 || !cur.length) return null;
          const m = median(b), sigma = Math.max(1.4826 * mad(b), 0.008 * m);
          const price = median(cur.map((o) => o.price));
          return { r, change: price / m - 1, z: (price - m) / sigma, m, price, ids: cur.map((o) => o.id) };
        }).filter(Boolean) as { r: string; change: number; z: number; m: number; price: number; ids: number[] }[];
        if (per.length) {
          const change = median(per.map((p) => p.change)), z = median(per.map((p) => p.z));
          const movers = per.filter((p) => Math.abs(p.change) * 100 >= S.min_change_pct && Math.sign(p.change) === Math.sign(change) && Math.abs(p.z) >= S.z_threshold);
          if (Math.abs(change) * 100 >= S.min_change_pct && Math.abs(z) >= S.z_threshold && movers.length) {
            const coverage = movers.length / nRet;
            const ex = exposureFromGap(rev, Math.abs(change), coverage, e, S);
            const kind: MoveKind = change < 0 ? "price_cut" : "price_rise";
            const baseline = median(per.map((p) => p.m)), observed = median(per.map((p) => p.price));
            out.push({
              kind, skuId: sku.id, nestleSkuId: nestleId, channelId: ch,
              title: `${sku.brand} ${change < 0 ? "cut" : "raised"} ${sku.name} price by ${pct(change)} in ${inp.channelName[ch]}`,
              baseline, observed, changePct: round(change * 100, 1), z: round(z, 1), coverage: round(coverage, 2),
              exposure: ex.mid, exposureLow: ex.low, exposureHigh: ex.high, level: levelOf(ex.mid, S, change > 0 ? "Low" : undefined), revenueWeek: rev,
              evidence: [
                ...movers.slice(0, 6).map((p) => ({ obsId: p.ids[p.ids.length - 1], fact: `${Math.round(p.price).toLocaleString("en-US")} vs usual ${Math.round(p.m).toLocaleString("en-US")} (${round((p.change) * 100, 1)}%)` })),
                { fact: `${movers.length} of ${nRet} retailers in ${inp.channelName[ch]} show it` },
              ],
            });
          }
        }

        // ---- promo depth: the price a shopper pays after promo or voucher
        const promoObs = recent.filter((o) => o.promoPrice != null && 1 - o.promoPrice / o.price >= S.promo_depth_pct / 100);
        const promoRet = [...new Set(promoObs.map((o) => o.retailerId))];
        const priorPromo = base.filter((o) => o.promoPrice != null && 1 - o.promoPrice / o.price >= S.promo_depth_pct / 100).length;
        if (promoRet.length && priorPromo <= base.length * 0.1) {
          const depth = median(promoObs.map((o) => 1 - (o.promoPrice as number) / o.price));
          const coverage = promoRet.length / nRet;
          const ex = exposureFromGap(rev, depth, coverage, e, S);
          out.push({
            kind: "promo", skuId: sku.id, nestleSkuId: nestleId, channelId: ch,
            title: `${sku.brand} promo on ${sku.name}: shoppers pay ${pct(depth)} less in ${inp.channelName[ch]}`,
            baseline: null, observed: null, changePct: round(-depth * 100, 1), z: null, coverage: round(coverage, 2),
            exposure: ex.mid, exposureLow: ex.low, exposureHigh: ex.high, level: levelOf(ex.mid, S), revenueWeek: rev,
            evidence: [...promoObs.slice(-6).map((o) => ({ obsId: o.id, fact: `${o.price} on shelf, ${o.promoPrice} after ${o.promoText ?? "promo"}` })), { fact: `${promoRet.length} of ${nRet} retailers show a promo` }],
          });
        }

        // ---- pack change
        const bp = base.map((o) => o.packMl ?? sku.packMl), rp = recent.map((o) => o.packMl ?? sku.packMl);
        const bm = median(bp), rm = median(rp);
        if (bm > 0 && rm !== bm && recent.length >= 2) {
          const ch2 = rm / bm - 1;
          const perMl = (1 / (1 + ch2)) - 1; // price per ml moves the other way when the price is held
          const coverage = new Set(recent.filter((o) => (o.packMl ?? sku.packMl) === rm).map((o) => o.retailerId)).size / nRet;
          const ex = exposureFromGap(rev, Math.abs(perMl), coverage, e, S);
          out.push({
            kind: "pack_change", skuId: sku.id, nestleSkuId: nestleId, channelId: ch,
            title: `${sku.brand} changed ${sku.name} pack from ${bm} ml to ${rm} ml in ${inp.channelName[ch]}`,
            baseline: bm, observed: rm, changePct: round(ch2 * 100, 1), z: null, coverage: round(coverage, 2),
            exposure: ex.mid, exposureLow: ex.low, exposureHigh: ex.high, level: levelOf(ex.mid, S, "Medium"), revenueWeek: rev,
            evidence: [{ obsId: recent[recent.length - 1].id, fact: `Pack ${rm} ml now, ${bm} ml before; price per ml ${perMl > 0 ? "up" : "down"} ${pct(perMl)} if the shelf price is held` }],
          });
        }
      }

      // ---- out of stock on our own SKU
      if (sku.isNestle) {
        const week = mine.filter((o) => o.on >= addDays(asOf, -6));
        const oos = [...new Set(week.filter((o) => !o.inStock || o.facings === 0).map((o) => o.retailerId))];
        if (oos.length >= S.oos_min_retailers) {
          const share = oos.length / nRet;
          const mid = rev * share * S.oos_loss_rate;
          out.push({
            kind: "out_of_stock", skuId: sku.id, nestleSkuId: sku.id, channelId: ch,
            title: `${sku.name} out of stock at ${oos.length} retailers in ${inp.channelName[ch]}`,
            baseline: null, observed: oos.length, changePct: null, z: null, coverage: round(share, 2),
            exposure: mid, exposureLow: mid * 0.6, exposureHigh: mid * 1.4, level: levelOf(mid, S), revenueWeek: rev,
            evidence: [...week.filter((o) => !o.inStock || o.facings === 0).slice(-6).map((o) => ({ obsId: o.id, fact: `Empty slot seen on ${o.on}` })), { fact: `${oos.length} of ${nRet} retailers` }],
          });
        }
      }
    }
  }

  // ---- shelf price gap: our premium over the competing SKU, now vs before
  for (const comp of skus.filter((s) => !s.isNestle)) {
    const ours = skuBy.get(comp.competesWith!)!;
    for (const ch of channels) {
      const gapAt = (from: string, to: string) => {
        const a = obs.filter((o) => o.skuId === ours.id && o.channelId === ch && o.on >= from && o.on <= to).map((o) => o.price);
        const b = obs.filter((o) => o.skuId === comp.id && o.channelId === ch && o.on >= from && o.on <= to).map((o) => o.price);
        return a.length && b.length ? median(a) / median(b) - 1 : null;
      };
      const now = gapAt(addDays(asOf, -13), asOf), before = gapAt(baseFrom, baseTo);
      if (now == null || before == null) continue;
      const hasPhoto = obs.some((o) => o.skuId === comp.id && o.channelId === ch && o.on >= addDays(asOf, -13) && o.source !== "feed" && o.source !== "price_list");
      const ownChange = (() => { const a = obs.filter((o) => o.skuId === ours.id && o.channelId === ch && o.on >= addDays(asOf, -13)).map((o) => o.price), b = obs.filter((o) => o.skuId === ours.id && o.channelId === ch && o.on >= baseFrom && o.on <= baseTo).map((o) => o.price); return a.length && b.length ? Math.abs(median(a) / median(b) - 1) : 0; })();
      if (now * 100 >= S.shelf_gap_pct && now - before >= 0.03 && ownChange < 0.02 && !out.some((m) => m.skuId === comp.id && m.channelId === ch && (m.kind === "price_cut" || m.kind === "promo"))) {
        const rev = revenueWeek(sales, ours.id, ch, asOf);
        const e = inp.elasticity(ours.id, ch);
        const coverage = Math.min(1, obs.filter((o) => o.skuId === ours.id && o.channelId === ch && o.on >= addDays(asOf, -13)).length / Math.max(1, inp.retailersPerChannel[ch]) / 2);
        const ex = exposureFromGap(rev, now - before, coverage, e, S);
        out.push({
          kind: "shelf_gap", skuId: comp.id, nestleSkuId: ours.id, channelId: ch,
          title: `${ours.name} sits ${pct(now)} above ${comp.brand} on the shelf in ${inp.channelName[ch]}`,
          baseline: round(before * 100, 1), observed: round(now * 100, 1), changePct: round(now * 100, 1), z: null, coverage: round(coverage, 2),
          exposure: ex.mid, exposureLow: ex.low, exposureHigh: ex.high, level: levelOf(ex.mid, S), revenueWeek: rev,
          evidence: [{ fact: `Gap now ${pct(now)}, usual ${pct(before)}${hasPhoto ? " (includes confirmed shelf photos)" : ""}` }],
        });
      }
    }
  }
  return out.sort((a, b) => b.exposure - a.exposure);
}
export { ENGINE_VERSION };

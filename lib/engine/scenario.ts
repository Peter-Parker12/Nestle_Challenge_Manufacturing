import { ENGINE_VERSION, round, type Elast, type Move, type Scenario, type Settings } from "./types";

/**
 * Response scenarios for a move. Volume and margin come from a simple, transparent model (diversion x elasticity),
 * with a range from the elasticity interval. Claude never produces these numbers; it only explains them.
 * Margin change = revenue x (1 + volume change) x (gross margin - coverage x price cut) - revenue x gross margin.
 */
export function marginDelta(rev: number, gm: number, volumeChange: number, coverage: number, priceCut: number) {
  return rev * (1 + volumeChange) * (gm - coverage * priceCut) - rev * gm;
}

export function buildScenarios(m: Move, e: Elast, S: Settings, retailersInChannel: number): Scenario[] {
  const rev = m.revenueWeek, gm = S.gross_margin;
  const lowConf = e.method === "default" || m.coverage < 0.4;
  const baseConf = lowConf ? "Low" : e.high - e.low <= 1.2 ? "High" : "Medium";
  const common = { engine: ENGINE_VERSION, elasticity: e.value, elasticity_low: e.low, elasticity_high: e.high, elasticity_method: e.method, diversion_rate: S.diversion_rate, gross_margin: gm, revenue_week_vnd: Math.round(rev), coverage: m.coverage };
  const retailersHit = Math.max(1, Math.round(m.coverage * retailersInChannel));

  if (m.kind === "out_of_stock") {
    const loss = -m.exposure / (rev || 1);
    return [
      { label: "A", kind: "hold", title: "Hold", volumePct: round(loss * 100), volumeLow: round(loss * 140), volumeHigh: round(loss * 60), marginVnd: round(-m.exposure * gm, 0), costText: "None",
        riskText: "Shoppers switch brand while the slot stays empty; some do not come back.", confidence: "Medium", needsCategoryManager: false, assumptions: { ...common, loss_rate: S.oos_loss_rate } },
      { label: "B", kind: "restock", title: "Expedite restock", volumePct: round(loss * 0.3 * 100), volumeLow: round(loss * 0.5 * 100), volumeHigh: round(loss * 0.1 * 100), marginVnd: round(-m.exposure * 0.3 * gm, 0), costText: `Priority delivery to ${retailersHit} retailers`,
        riskText: "Depends on stock at the depot and the chain's receiving slots.", confidence: "Medium", needsCategoryManager: false, assumptions: { ...common, recovered_share: 0.7 } },
    ];
  }
  const delta = Math.abs((m.kind === "pack_change" ? 1 - (m.baseline ?? 1) / ((m.observed ?? m.baseline ?? 1) || 1) : (m.changePct ?? 0) / 100) || 0.0001);
  const D = m.kind === "shelf_gap" ? Math.abs(m.observed! - m.baseline!) / 100 : m.kind === "promo" ? Math.abs(m.changePct! / 100) : delta;
  const lossAt = (el: number) => S.diversion_rate * Math.abs(el) * D * m.coverage;
  const s = lossAt(e.value);
  const hold = { mid: -s, worse: -lossAt(e.low), better: -lossAt(e.high) };

  if (m.kind === "price_rise") {
    return [{ label: "A", kind: "hold", title: "Hold price and watch", volumePct: round(s * 100), volumeLow: round(lossAt(e.high) * 100), volumeHigh: round(lossAt(e.low) * 100), marginVnd: round(rev * s * gm, 0), costText: "None",
      riskText: "An opportunity: the gap moved in our favour. A promo now would give margin away for no reason.", confidence: baseConf, needsCategoryManager: false, assumptions: { ...common, competitor_change_pct: m.changePct } }];
  }

  const p = S.promo_depth_scenario_pct / 100;
  const cov = Math.max(m.coverage, 0.25);
  const promoNet = (el: number) => -lossAt(el) + cov * Math.abs(el) * p;
  const promoNetMid = promoNet(e.value);
  const matchP = Math.min(0.1, Math.max(0.03, Math.round(D * 0.5 * 100) / 100));
  const matchNet = (el: number) => -lossAt(el) + Math.abs(el) * matchP;
  const u = S.shelf_uplift_pct / 100;
  const shelfNet = (el: number) => -lossAt(el) + cov * u;

  return [
    { label: "A", kind: "hold", title: "Hold", volumePct: round(hold.mid * 100), volumeLow: round(hold.worse * 100), volumeHigh: round(hold.better * 100), marginVnd: round(marginDelta(rev, gm, hold.mid, 0, 0), 0), costText: "None",
      riskText: "Share keeps falling if the move stays. Assumes the competitor does not cut further.", confidence: baseConf, needsCategoryManager: false, assumptions: { ...common, move_size: round(D, 3) } },
    { label: "B", kind: "promo", title: `Targeted promo (${S.promo_depth_scenario_pct}%)`, volumePct: round(promoNetMid * 100), volumeLow: round(Math.min(promoNet(e.high), promoNet(e.low)) * 100), volumeHigh: round(Math.max(promoNet(e.high), promoNet(e.low)) * 100),
      marginVnd: round(marginDelta(rev, gm, promoNetMid, cov, p), 0), costText: `2 weeks at the ${retailersHit} retailers affected`,
      riskText: "Shoppers may wait for the next promo. It ends cleanly after two weeks and is easy to reverse.", confidence: baseConf, needsCategoryManager: false, assumptions: { ...common, promo_depth: p, covered_share: cov } },
    { label: "C", kind: "match_price", title: `Match price (${round(matchP * 100, 0)}% cut)`, volumePct: round(matchNet(e.value) * 100), volumeLow: round(Math.min(matchNet(e.high), matchNet(e.low)) * 100), volumeHigh: round(Math.max(matchNet(e.high), matchNet(e.low)) * 100),
      marginVnd: round(marginDelta(rev, gm, matchNet(e.value), 1, matchP), 0), costText: "All retailers in the channel",
      riskText: "Can start a price war and is hard to walk back. Needs category manager approval.", confidence: baseConf === "High" ? "Medium" : baseConf, needsCategoryManager: true, assumptions: { ...common, price_cut: matchP } },
    { label: "D", kind: "shelf_action", title: "Shelf action", volumePct: round(shelfNet(e.value) * 100), volumeLow: round(Math.min(shelfNet(e.high), shelfNet(e.low)) * 100), volumeHigh: round(Math.max(shelfNet(e.high), shelfNet(e.low)) * 100),
      marginVnd: round(marginDelta(rev, gm, shelfNet(e.value), 0, 0), 0), costText: `Secondary display at ${retailersHit} retailers (fees not modelled)`,
      riskText: "Display space depends on the retailer agreeing. Little history for this action, so the uplift is an assumption.", confidence: "Low", needsCategoryManager: false, assumptions: { ...common, uplift: u, covered_share: cov } },
  ];
}

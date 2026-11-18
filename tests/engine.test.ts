import { describe, expect, it } from "vitest";
import { detectMoves } from "../lib/engine/detect";
import { estimateElasticity } from "../lib/engine/elasticity";
import { buildScenarios, marginDelta } from "../lib/engine/scenario";
import { DEFAULT_SETTINGS, addDays, mad, median, type Elast, type Obs, type Sales, type Sku } from "../lib/engine/types";

const S = DEFAULT_SETTINGS;
const D = "2026-11-18";
const el: Elast = { value: -1.6, low: -2.0, high: -1.2, method: "log-log", n: 52 };

// a deterministic wiggle so the usual range is not zero
const wig = (i: number) => 1 + 0.004 * Math.sin(i * 1.7);

function world(opts: { cut?: number; retailersCut?: number; promo?: boolean; ownPriceMove?: boolean } = {}) {
  const skus: Sku[] = [
    { id: "n1", code: "N1", name: "UHT 1 L", brand: "Nestlé", isNestle: true, packMl: 1000, competesWith: null },
    { id: "c1", code: "C1", name: "UHT 1 L", brand: "Competitor A", isNestle: false, packMl: 1000, competesWith: "n1" },
  ];
  const obs: Obs[] = []; let id = 1;
  const rets = ["r1", "r2", "r3", "r4"];
  for (const r of rets) for (let k = 1; k <= 40; k++) {
    const on = addDays(D, -7 * k - 1);
    obs.push({ id: id++, skuId: "c1", retailerId: r, channelId: "mt", on, price: Math.round(24600 * wig(k + r.length)), promoPrice: null, packMl: 1000, inStock: true, facings: 2, source: "feed" });
    obs.push({ id: id++, skuId: "n1", retailerId: r, channelId: "mt", on, price: Math.round(25400 * wig(k)), promoPrice: null, packMl: 1000, inStock: true, facings: 2, source: "feed" });
  }
  rets.forEach((r, i) => {
    for (let a = 0; a <= 2; a++) {
      const hit = opts.cut && i < (opts.retailersCut ?? 3);
      obs.push({ id: id++, skuId: "c1", retailerId: r, channelId: "mt", on: addDays(D, -a), price: Math.round(24600 * (hit ? 1 - opts.cut! : 1)), promoPrice: opts.promo ? Math.round(24600 * 0.8) : null, packMl: 1000, inStock: true, facings: 2, source: "feed" });
      obs.push({ id: id++, skuId: "n1", retailerId: r, channelId: "mt", on: addDays(D, -a), price: 25400, promoPrice: null, packMl: 1000, inStock: true, facings: 2, source: "feed" });
    }
  });
  const sales: Sales[] = [];
  for (let k = 1; k <= 20; k++) sales.push({ skuId: "n1", channelId: "mt", weekStart: addDays(D, -7 * k - 1), units: 150_000, revenue: 3_800_000_000 });
  return { skus, obs, sales };
}
const run = (w: ReturnType<typeof world>, settings = S) => detectMoves({ asOf: D, ...w, retailersPerChannel: { mt: 4 }, channelName: { mt: "Modern trade" }, settings, elasticity: () => el });

describe("robust statistics", () => {
  it("median and MAD ignore one outlier", () => {
    expect(median([1, 2, 3, 4, 100])).toBe(3);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
  });
});

describe("elasticity", () => {
  const series = (e: number, weeks: number, noise = 0.02): Sales[] => Array.from({ length: weeks }, (_, i) => {
    const p = 25000 * (1 + 0.1 * Math.sin(i * 0.9) * (i % 3 === 0 ? 1 : 0.4));
    const u = 1e5 * Math.pow(p / 25000, e) * (1 + noise * Math.sin(i * 12.9898));
    return { skuId: "s", channelId: "c", weekStart: addDays("2025-01-06", i * 7), units: u, revenue: u * p };
  });
  it("recovers a known elasticity from 52 weeks, with an interval that contains it", () => {
    const r = estimateElasticity(series(-1.6, 52), -1.4);
    expect(r.method).toBe("log-log");
    expect(r.value).toBeGreaterThan(-1.85); expect(r.value).toBeLessThan(-1.35);
    expect(r.low).toBeLessThan(r.value); expect(r.high).toBeGreaterThan(r.value);
  });
  it("falls back to the default when there are too few weeks", () => {
    const r = estimateElasticity(series(-1.6, 20), -1.4);
    expect(r.method).toBe("default"); expect(r.value).toBe(-1.4);
  });
  it("falls back when the price never moved", () => {
    const flat = Array.from({ length: 52 }, (_, i) => ({ skuId: "s", channelId: "c", weekStart: addDays("2025-01-06", i * 7), units: 1e5 + i, revenue: (1e5 + i) * 25000 }));
    expect(estimateElasticity(flat, -1.4).method).toBe("default");
  });
});

describe("move detection", () => {
  it("flags an 11% cut at 3 of 4 retailers and sizes the exposure", () => {
    const m = run(world({ cut: 0.11 }));
    const cut = m.find((x) => x.kind === "price_cut")!;
    expect(cut).toBeTruthy();
    expect(cut.changePct).toBeLessThan(-9);
    expect(cut.coverage).toBeCloseTo(0.75, 2);
    expect(cut.exposureLow).toBeLessThan(cut.exposure); expect(cut.exposureHigh).toBeGreaterThan(cut.exposure);
    // rev 3.8B x diversion 0.3 x |eps| 1.6 x 0.11 x 0.75
    expect(cut.exposure).toBeCloseTo(3.8e9 * 0.3 * 1.6 * 0.11 * 0.75, -7);
    expect(cut.level).toBe("High");
    expect(cut.evidence.length).toBeGreaterThan(1);
  });
  it("ignores a small change and a quiet market", () => {
    expect(run(world({ cut: 0.02 })).filter((x) => x.kind === "price_cut")).toEqual([]);
    expect(run(world()).length).toBe(0);
  });
  it("does not flag a cut at a single retailer (the typical retailer did not move)", () => {
    expect(run(world({ cut: 0.15, retailersCut: 1 })).filter((x) => x.kind === "price_cut")).toEqual([]);
  });
  it("a lower threshold flags more, a higher one fewer", () => {
    const w = world({ cut: 0.04 });
    expect(run(w, { ...S, min_change_pct: 3 }).filter((x) => x.kind === "price_cut").length).toBe(1);
    expect(run(w, { ...S, min_change_pct: 6 }).filter((x) => x.kind === "price_cut").length).toBe(0);
  });
  it("sees a promo that the shelf price hides", () => {
    const m = run(world({ promo: true }));
    expect(m.some((x) => x.kind === "promo" && x.changePct! <= -19)).toBe(true);
    expect(m.some((x) => x.kind === "price_cut")).toBe(false);
  });
  it("a price rise is an opportunity: always Low", () => {
    const w = world({ cut: -0.08 });
    const m = run(w).find((x) => x.kind === "price_rise")!;
    expect(m.level).toBe("Low");
  });
});

describe("scenarios", () => {
  const move = () => run(world({ cut: 0.11 })).find((x) => x.kind === "price_cut")!;
  it("margin formula: volume change and a price cut on covered volume", () => {
    expect(marginDelta(100, 0.3, 0, 0, 0)).toBeCloseTo(0);
    expect(marginDelta(100, 0.3, -0.05, 0, 0)).toBeCloseTo(-1.5);
    expect(marginDelta(100, 0.3, 0, 1, 0.05)).toBeCloseTo(-5);
  });
  it("builds hold, promo, match price and shelf action with ordered ranges", () => {
    const sc = buildScenarios(move(), el, S, 4);
    expect(sc.map((s) => s.label)).toEqual(["A", "B", "C", "D"]);
    for (const s of sc) { expect(s.volumeLow).toBeLessThanOrEqual(s.volumePct + 0.05); expect(s.volumeHigh).toBeGreaterThanOrEqual(s.volumePct - 0.05); }
    expect(sc[0].volumePct).toBeLessThan(0);
    expect(sc[1].volumePct).toBeGreaterThan(sc[0].volumePct); // a promo recovers volume
    expect(sc[1].marginVnd).toBeLessThan(0);
  });
  it("only a price match needs a category manager; the shelf action is always low confidence", () => {
    const sc = buildScenarios(move(), el, S, 4);
    expect(sc.filter((s) => s.needsCategoryManager).map((s) => s.kind)).toEqual(["match_price"]);
    expect(sc[3].confidence).toBe("Low");
  });
  it("a default elasticity lowers confidence", () => {
    const sc = buildScenarios(move(), { ...el, method: "default" }, S, 4);
    expect(sc.every((s) => s.confidence === "Low")).toBe(true);
  });
  it("assumptions are stored with every scenario", () => {
    const sc = buildScenarios(move(), el, S, 4);
    for (const s of sc) { expect(s.assumptions.elasticity).toBe(-1.6); expect(s.assumptions.gross_margin).toBe(0.32); }
  });
});

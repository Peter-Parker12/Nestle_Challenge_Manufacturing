export const ENGINE_VERSION = "radar-engine-1.0.0";

export type Settings = {
  z_threshold: number; min_change_pct: number; promo_depth_pct: number; shelf_gap_pct: number; oos_min_retailers: number;
  diversion_rate: number; gross_margin: number; promo_depth_scenario_pct: number; shelf_uplift_pct: number; default_elasticity: number;
  oos_loss_rate: number; level_high_vnd: number; level_medium_vnd: number;
};
export const DEFAULT_SETTINGS: Settings = {
  z_threshold: 3, min_change_pct: 3, promo_depth_pct: 12, shelf_gap_pct: 8, oos_min_retailers: 3,
  diversion_rate: 0.3, gross_margin: 0.32, promo_depth_scenario_pct: 5, shelf_uplift_pct: 3, default_elasticity: -1.4,
  oos_loss_rate: 0.3, level_high_vnd: 120_000_000, level_medium_vnd: 40_000_000,
};

export type Sku = { id: string; code: string; name: string; brand: string; isNestle: boolean; packMl: number; competesWith: string | null };
export type Obs = {
  id: number; skuId: string; retailerId: string; channelId: string; on: string; price: number; promoPrice: number | null;
  promoText?: string | null; packMl: number | null; inStock: boolean; facings: number | null; source: string;
};
export type Sales = { skuId: string; channelId: string; weekStart: string; units: number; revenue: number };
export type Elast = { value: number; low: number; high: number; method: "log-log" | "default"; n: number };

export type MoveKind = "price_cut" | "price_rise" | "promo" | "pack_change" | "shelf_gap" | "out_of_stock";
export type Level = "High" | "Medium" | "Low";
export type Move = {
  kind: MoveKind; skuId: string; nestleSkuId: string; channelId: string; title: string; baseline: number | null; observed: number | null;
  changePct: number | null; z: number | null; coverage: number; exposure: number; exposureLow: number; exposureHigh: number; level: Level;
  evidence: { obsId?: number; fact: string }[]; revenueWeek: number;
};

export type ScenarioKind = "hold" | "promo" | "match_price" | "shelf_action" | "restock";
export type Scenario = {
  label: string; kind: ScenarioKind; title: string; volumePct: number; volumeLow: number; volumeHigh: number; marginVnd: number; costText: string;
  riskText: string; confidence: Level; needsCategoryManager: boolean; assumptions: Record<string, unknown>;
};

export const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const mad = (a: number[]) => { const m = median(a); return median(a.map((x) => Math.abs(x - m))); };
export const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Seal risk engine (BAF-2). Pure and deterministic: the same inputs and weights always give the same score.
 * Score 0 to 100 = weighted share of factor values (each 0 to 1), times a criticality multiplier, then expert floors.
 * A factor with no data is left out and the weights of the others are renormalised; it is listed as missing, never guessed.
 */
export const SEAL_ENGINE_VERSION = "seal-engine-1.0.0";

export const FACTORS = ["age", "runtime", "cip", "thermal", "pressure", "inspection", "gap", "history", "incidents"] as const;
export type FactorKey = (typeof FACTORS)[number];
export type Weights = Record<FactorKey, number>;

export const DEFAULT_WEIGHTS: Weights = { age: 3, runtime: 2, cip: 1, thermal: 2, pressure: 1, inspection: 4, gap: 1, history: 2, incidents: 3 };
export const FACTOR_LABEL: Record<FactorKey, string> = {
  age: "Age against planned life", runtime: "Run hours against rated hours", cip: "CIP cycles against rated cycles",
  thermal: "Weeks above rated temperature", pressure: "Weeks above rated pressure", inspection: "Last inspection",
  gap: "Time since last inspection", history: "Earlier seals here that failed", incidents: "Incidents here in 12 months",
};
export const HIGH_AT = 70;
export const MEDIUM_AT = 40;
export const RATING_VALUE = [0, 0, 0.25, 0.6, 0.9, 1];

export type SealInput = {
  ageDays: number;
  nominalLifeDays: number;
  criticality: number;
  runHours: number | null;          // since fitted; null = no exposure data
  nominalRunHours: number | null;
  cipCycles: number | null;
  nominalCipCycles: number | null;
  weeksExposed: number;
  weeksOverTemp: number | null;     // null = seal type has no rated temperature
  weeksOverPressure: number | null;
  lastRating: number | null;
  daysSinceInspection: number | null;   // null = never inspected
  priorSeals: number;
  priorFailures: number;
  incidents12m: number;
  foreignBody30d: boolean;
};

export type Factor = { key: FactorKey; label: string; value: number | null; weight: number; points: number; missing: boolean; note: string };
export type SealScore = {
  score: number; level: "Low" | "Medium" | "High"; base: number; multiplier: number;
  factors: Factor[]; floors: { rule: string; text: string }[]; missing: FactorKey[]; engineVersion: string;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const r1 = (n: number) => Math.round(n * 10) / 10;
export const levelOf = (s: number): "Low" | "Medium" | "High" => (s >= HIGH_AT ? "High" : s >= MEDIUM_AT ? "Medium" : "Low");
export const multiplierOf = (criticality: number) => r1(0.7 + 0.1 * criticality * 1) ; // criticality 3 = 1.0, 5 = 1.2, 1 = 0.8

export function scoreSeal(i: SealInput, w: Weights = DEFAULT_WEIGHTS): SealScore {
  const f: Record<FactorKey, { v: number | null; note: string }> = {
    age: { v: clamp01(i.ageDays / (1.25 * i.nominalLifeDays)), note: `${i.ageDays} of ${i.nominalLifeDays} planned days` },
    runtime: i.runHours != null && i.nominalRunHours ? { v: clamp01(i.runHours / (1.25 * i.nominalRunHours)), note: `${Math.round(i.runHours)} of ${i.nominalRunHours} rated hours` } : { v: null, note: "no run-hour data or rating" },
    cip: i.cipCycles != null && i.nominalCipCycles ? { v: clamp01(i.cipCycles / (1.25 * i.nominalCipCycles)), note: `${i.cipCycles} of ${i.nominalCipCycles} rated cycles` } : { v: null, note: "no CIP data or rating" },
    thermal: i.weeksOverTemp != null && i.weeksExposed > 0 ? { v: clamp01((2 * i.weeksOverTemp) / i.weeksExposed), note: `${i.weeksOverTemp} of ${i.weeksExposed} weeks above the rated temperature` } : { v: null, note: "no temperature data or rating" },
    pressure: i.weeksOverPressure != null && i.weeksExposed > 0 ? { v: clamp01((2 * i.weeksOverPressure) / i.weeksExposed), note: `${i.weeksOverPressure} of ${i.weeksExposed} weeks above the rated pressure` } : { v: null, note: "no pressure data or rating" },
    inspection: i.lastRating != null ? { v: RATING_VALUE[i.lastRating], note: `last rated ${i.lastRating} of 5` } : { v: null, note: "never inspected" },
    gap: { v: clamp01((i.daysSinceInspection ?? i.ageDays) / (0.4 * i.nominalLifeDays)), note: i.daysSinceInspection == null ? "never inspected" : `${i.daysSinceInspection} days since the last inspection` },
    history: i.priorSeals >= 2 ? { v: clamp01(i.priorFailures / 2), note: `${i.priorFailures} of ${i.priorSeals} earlier seals failed` } : { v: null, note: "fewer than 2 earlier seals" },
    incidents: { v: clamp01(i.incidents12m / 2), note: `${i.incidents12m} in 12 months` },
  };
  const used = FACTORS.filter((k) => f[k].v != null && w[k] > 0);
  const total = used.reduce((s, k) => s + w[k], 0);
  const m = multiplierOf(i.criticality);
  const base = total > 0 ? (100 * used.reduce((s, k) => s + w[k] * (f[k].v as number), 0)) / total : 0;
  const factors: Factor[] = FACTORS.map((k) => {
    const on = f[k].v != null && w[k] > 0 && total > 0;
    return { key: k, label: FACTOR_LABEL[k], value: f[k].v, weight: w[k], points: on ? r1(((100 * w[k] * (f[k].v as number)) / total) * m) : 0, missing: f[k].v == null, note: f[k].note };
  });
  let score = Math.min(100, base * m);
  const floors: SealScore["floors"] = [];
  const floor = (rule: string, min: number, text: string) => { if (score < min) { score = min; floors.push({ rule, text }); } };
  if ((i.lastRating ?? 0) >= 4) floor("F1", 75, "Rated damaged or failed at the last inspection: High until the seal is replaced");
  if (i.foreignBody30d && i.ageDays > i.nominalLifeDays) floor("F2", 85, "Foreign body found here in the last 30 days and the seal is past its planned life");
  if (i.ageDays > 1.5 * i.nominalLifeDays) floor("F3", 70, "More than 1.5 times the planned life");
  score = r1(score);
  return { score, level: levelOf(score), base: r1(base), multiplier: m, factors, floors, missing: FACTORS.filter((k) => f[k].v == null), engineVersion: SEAL_ENGINE_VERSION };
}

export type Rates = { runPerDay: number | null; cipPerDay: number | null };

/** Days until the score first reaches High if the seal keeps being used at its recent rates. 0 = already High, null = not within the horizon. */
export function projectHigh(i: SealInput, rates: Rates, w: Weights = DEFAULT_WEIGHTS, horizon = 365): number | null {
  if (scoreSeal(i, w).score >= HIGH_AT) return 0;
  const at = (d: number): SealInput => ({
    ...i, ageDays: i.ageDays + d,
    runHours: i.runHours != null && rates.runPerDay != null ? i.runHours + rates.runPerDay * d : i.runHours,
    cipCycles: i.cipCycles != null && rates.cipPerDay != null ? i.cipCycles + rates.cipPerDay * d : i.cipCycles,
    daysSinceInspection: i.daysSinceInspection != null ? i.daysSinceInspection + d : null,
    weeksExposed: i.weeksExposed + Math.floor(d / 7),
  });
  let lo = 1, hi = horizon;
  if (scoreSeal(at(hi), w).score < HIGH_AT) return null;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (scoreSeal(at(mid), w).score >= HIGH_AT) hi = mid; else lo = mid + 1; }
  return lo;
}

export type Stop = { id: string; start_on: string; end_on: string; kind: string; line_code?: string };
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Pick the planned stop to change the seal in: already High, the first suitable stop; otherwise the last suitable stop before the projected High date. */
export function recommendStop(stops: Stop[], today: string, projectedDays: number | null): { stop: Stop | null; before: boolean; note: string } {
  const usable = stops.filter((s) => s.kind !== "CIP" && s.start_on >= today).sort((a, b) => a.start_on.localeCompare(b.start_on));
  if (!usable.length) return { stop: null, before: false, note: "No maintenance window is planned. Plan one." };
  if (projectedDays === 0) return { stop: usable[0], before: true, note: "Already High: use the first window." };
  if (projectedDays == null) return { stop: usable[0], before: true, note: "Not expected to reach High within a year: use a convenient window." };
  const limit = addDays(today, projectedDays);
  const ok = usable.filter((s) => s.end_on <= limit);
  if (ok.length) return { stop: ok[ok.length - 1], before: true, note: "The last window before the projected High date." };
  return { stop: usable[0], before: false, note: `No window before the projected High date (${limit}). Plan one earlier.` };
}

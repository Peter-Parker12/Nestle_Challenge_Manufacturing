/**
 * Line-health engine (DNF-2). Pure and deterministic, like the seal engine.
 * A station's attention score (0 to 100) is the weighted share of six factors, each 0 to 1:
 * alarm rate against its usual rate, alarm trend, unplanned downtime, defects, overdue maintenance, and the risk of the seals in the same assembly.
 * Stoppage prediction is a trend against the level of faults seen before earlier stops. It is not a trained model.
 */
export const HEALTH_ENGINE_VERSION = "health-engine-1.0.0";

export const H_FACTORS = ["alarms", "trend", "downtime", "defects", "maintenance", "seal"] as const;
export type HFactor = (typeof H_FACTORS)[number];
export const H_WEIGHTS: Record<HFactor, number> = { alarms: 3, trend: 2, downtime: 3, defects: 2, maintenance: 2, seal: 3 };
export const H_LABEL: Record<HFactor, string> = {
  alarms: "Alarm rate against usual", trend: "Alarm trend", downtime: "Unplanned downtime, 14 days", defects: "Defects, 14 days",
  maintenance: "Overdue maintenance", seal: "Seal risk in this assembly",
};
export const H_HIGH = 60;
export const H_MEDIUM = 35;
export const hLevel = (s: number): "Low" | "Medium" | "High" => (s >= H_HIGH ? "High" : s >= H_MEDIUM ? "Medium" : "Low");

export type StationInput = {
  alarms7: number;
  usualPerWeek: number;            // average weekly alarms over the 8 weeks before
  weeklyAlarms: number[];          // oldest to newest, the last entry is the most recent 7 days
  downtimeMin14: number;
  defects14: number;
  overdueDays: number;             // most overdue open task, 0 if none
  sealScore: number | null;        // 0 to 100 from BAF-2, null if no seal is tracked here
};
export type HFactorOut = { key: HFactor; label: string; value: number | null; weight: number; points: number; note: string; missing: boolean };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

export function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  return den ? num / den : 0;
}

export function scoreStation(i: StationInput) {
  const recent = i.weeklyAlarms.slice(-6);
  const sl = slope(recent);
  const meanPrev = recent.length > 1 ? recent.slice(0, -1).reduce((a, b) => a + b, 0) / (recent.length - 1) : 0;
  const f: Record<HFactor, { v: number | null; note: string }> = {
    alarms: { v: i.usualPerWeek > 0 ? clamp01((i.alarms7 / i.usualPerWeek - 1) / 2) : clamp01(i.alarms7 / 6), note: `${i.alarms7} alarms in 7 days, usually ${r1(i.usualPerWeek)} a week` },
    trend: { v: clamp01(sl / Math.max(1, meanPrev)), note: sl > 0.3 ? `rising by about ${r1(sl)} a week` : "not rising" },
    downtime: { v: clamp01(i.downtimeMin14 / 120), note: `${Math.round(i.downtimeMin14)} minutes unplanned stop` },
    defects: { v: clamp01(i.defects14 / 20), note: `${i.defects14} defects` },
    maintenance: { v: clamp01(i.overdueDays / 14), note: i.overdueDays > 0 ? `a task is ${i.overdueDays} days overdue` : "nothing overdue" },
    seal: i.sealScore != null ? { v: clamp01(i.sealScore / 100), note: `seal risk score ${i.sealScore}` } : { v: null, note: "no seal tracked in this assembly" },
  };
  const used = H_FACTORS.filter((k) => f[k].v != null);
  const total = used.reduce((s, k) => s + H_WEIGHTS[k], 0);
  const score = r1(total ? (100 * used.reduce((s, k) => s + H_WEIGHTS[k] * (f[k].v as number), 0)) / total : 0);
  const factors: HFactorOut[] = H_FACTORS.map((k) => ({
    key: k, label: H_LABEL[k], value: f[k].v, weight: H_WEIGHTS[k], note: f[k].note, missing: f[k].v == null,
    points: f[k].v != null && total ? r1((100 * H_WEIGHTS[k] * (f[k].v as number)) / total) : 0,
  }));
  return { score, level: hLevel(score), factors, engineVersion: HEALTH_ENGINE_VERSION };
}

export type Prediction = { status: "unknown" | "at_or_above" | "rising" | "not_rising"; weeks: number | null; threshold: number | null; current: number; text: string };

/** weeklyFaults: oldest to newest. threshold: faults in the week before earlier breakdowns (median), null if there were fewer than two. */
export function predictStop(weeklyFaults: number[], threshold: number | null): Prediction {
  const current = weeklyFaults.length ? weeklyFaults[weeklyFaults.length - 1] : 0;
  if (threshold == null) return { status: "unknown", weeks: null, threshold: null, current, text: "Not enough earlier stops at this machine to say what a warning level looks like." };
  if (current >= threshold) return { status: "at_or_above", weeks: 0, threshold, current, text: `${current} faults in the last 7 days, at or above the ${threshold} seen in the week before earlier stops. A stop is likely within a week or two unless it is addressed.` };
  const sl = slope(weeklyFaults.slice(-6));
  if (sl > 0.2) {
    const weeks = Math.ceil((threshold - current) / sl);
    if (weeks <= 8) return { status: "rising", weeks, threshold, current, text: `Faults are rising by about ${r1(sl)} a week. At this rate they reach the level seen before earlier stops (${threshold}) in about ${weeks} week${weeks === 1 ? "" : "s"}.` };
  }
  return { status: "not_rising", weeks: null, threshold, current, text: `${current} faults in the last 7 days against ${threshold} before earlier stops, and not rising fast.` };
}

import type { WeightLevels } from "./types";

/** 0..5 labelled scale (D-05). Internal values are deliberately uneven so Critical counts much more than Minor. */
export const LEVEL_LABELS = ["Ignore", "Minor", "Moderate", "Important", "Very important", "Critical"] as const;
export const LEVEL_VALUE = [0, 1, 2, 3, 5, 8] as const;
export const DEFAULT_LEVEL = 3;

export function levelValue(level: number): number {
  const l = Math.max(0, Math.min(5, Math.round(level)));
  return LEVEL_VALUE[l];
}

/** Convert levels to weights that sum to 1. If everything is "Ignore", fall back to equal weights. */
export function normalise(levels: Record<string, number>): Record<string, number> {
  const keys = Object.keys(levels);
  const vals = keys.map((k) => levelValue(levels[k]));
  const total = vals.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  keys.forEach((k, i) => (out[k] = total > 0 ? vals[i] / total : 1 / keys.length));
  return out;
}

/** Merge layers. The most specific layer wins (recipe > category > platform default). */
export function resolveLevels(
  codes: string[],
  layers: { platform?: Record<string, number>; category?: Record<string, number>; recipe?: Record<string, number> },
): { levels: Record<string, number>; source: Record<string, "recipe" | "category" | "platform" | "default"> } {
  const levels: Record<string, number> = {};
  const source: Record<string, "recipe" | "category" | "platform" | "default"> = {};
  for (const c of codes) {
    if (layers.recipe && c in layers.recipe) (levels[c] = layers.recipe[c]), (source[c] = "recipe");
    else if (layers.category && c in layers.category) (levels[c] = layers.category[c]), (source[c] = "category");
    else if (layers.platform && c in layers.platform) (levels[c] = layers.platform[c]), (source[c] = "platform");
    else (levels[c] = DEFAULT_LEVEL), (source[c] = "default");
  }
  return { levels, source };
}

/** BR-08: warn when too many items are Critical or the pool of matches becomes too small. */
export function weightWarnings(w: WeightLevels, matchedPool?: number, minMatched?: number): string[] {
  const out: string[] = [];
  const crit = (r: Record<string, number>) => Object.values(r).filter((v) => v >= 5).length;
  if (crit(w.attributes) > 2) out.push("More than two attributes are marked Critical. When everything is critical, nothing stands out.");
  if (crit(w.parameters) > 2) out.push("More than two parameters are marked Critical.");
  if (matchedPool !== undefined && minMatched !== undefined && matchedPool < minMatched)
    out.push(`These weights leave only ${matchedPool} similar launches (minimum ${minMatched}). Confidence will be Low.`);
  return out;
}

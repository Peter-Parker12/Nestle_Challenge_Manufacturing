import { normalise, DEFAULT_LEVEL } from "./weights";
import {
  ENGINE_VERSION, type Attrs, type Confidence, type HistLaunch, type Neighbour, type RecInput, type RecLine, type RecResult,
  type RiskFlag, type RuleCondition, type Severity, type SmeRule,
} from "./types";

const SEV_RANK: Record<Severity, number> = { Low: 0, Medium: 1, High: 2 };
const maxSev = (a: Severity, b: Severity): Severity => (SEV_RANK[b] > SEV_RANK[a] ? b : a);

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Weighted distance between the target and one historical launch (0 = identical).
 * Only fields that BOTH products have a value for are compared, and the weights are rescaled over those fields.
 * A missing value therefore never makes a launch look closer. `coverage` is the share of the total weight that could be compared.
 */
export function distanceWithCoverage(
  target: Attrs,
  cand: Attrs,
  attrs: RecInput["attrDefs"],
  w: Record<string, number>,
  ranges: Record<string, number>,
): { d: number; coverage: number } {
  let s = 0;
  let present = 0;
  let total = 0;
  for (const a of attrs) {
    const wa = w[a.code] ?? 0;
    total += wa;
    const t = target[a.code];
    const c = cand[a.code];
    if (t === undefined || c === undefined) continue;
    present += wa;
    let d: number;
    if (a.type === "numeric") d = Math.abs(Number(t) - Number(c)) / (ranges[a.code] || 1);
    else d = t === c ? 0 : 1;
    s += wa * d * d;
  }
  if (total === 0) return { d: 0, coverage: 1 };
  if (present === 0) return { d: 1, coverage: 0 };
  return { d: Math.sqrt(s * (total / present)), coverage: present / total };
}

export function distance(target: Attrs, cand: Attrs, attrs: RecInput["attrDefs"], w: Record<string, number>, ranges: Record<string, number>): number {
  return distanceWithCoverage(target, cand, attrs, w, ranges).d;
}

export const MATCHABLE_TYPES = ["numeric", "choice", "boolean"];

export function similarityFromDistance(d: number): number {
  return Math.exp(-3 * d);
}

export function evalCondition(cond: RuleCondition, target: Attrs): boolean {
  if ("all" in cond) return cond.all.every((c) => evalCondition(c, target));
  const v = target[cond.attr];
  if (v === undefined) return false;
  if (typeof cond.value === "boolean") return cond.op === "==" && v === cond.value;
  const a = typeof cond.value === "number" ? Number(v) : String(v);
  switch (cond.op) {
    case ">": return a > cond.value;
    case ">=": return a >= cond.value;
    case "<": return a < cond.value;
    case "<=": return a <= cond.value;
    case "==": return a === cond.value;
  }
}

function weightedStats(values: number[], weights: number[]) {
  const sw = weights.reduce((a, b) => a + b, 0) || 1;
  const mean = values.reduce((a, v, i) => a + v * weights[i], 0) / sw;
  const variance = values.reduce((a, v, i) => a + weights[i] * (v - mean) ** 2, 0) / sw;
  return { mean, sd: Math.sqrt(variance) };
}

export function recommend(input: RecInput): RecResult {
  const { paramDefs, target, lineId, lineCaps, history, weights, rules, topN, minMatched } = input;
  const minFieldCoverage = input.minFieldCoverage ?? 0.3;

  // Candidate pool: launches that reached acceptance.
  const pool = history.filter((h) => h.acceptedParams);

  // Only active matching fields of a comparable type are used, and only when enough of the history has a value for them.
  const ignoredFields: RecResult["ignoredFields"] = [];
  const attrDefs = input.attrDefs.filter((a) => {
    if ((a.kind ?? "matching") !== "matching" || !MATCHABLE_TYPES.includes(a.type) || (a.status ?? "Active") !== "Active") return false;
    if (pool.length > 0) {
      const cov = pool.filter((h) => h.attrs[a.code] !== undefined).length / pool.length;
      if (cov < minFieldCoverage) {
        ignoredFields.push({ code: a.code, name: a.name, reason: `only ${Math.round(cov * 100)}% of past launches have a value (minimum ${Math.round(minFieldCoverage * 100)}%)` });
        return false;
      }
    }
    return true;
  });
  const attrW = normalise(Object.fromEntries(attrDefs.map((a) => [a.code, weights.attributes[a.code] ?? DEFAULT_LEVEL])));
  const paramLevels = Object.fromEntries(paramDefs.map((p) => [p.code, weights.parameters[p.code] ?? DEFAULT_LEVEL]));
  const paramW = normalise(paramLevels);

  // Range per numeric attribute, over history plus the target, used to scale differences.
  const ranges: Record<string, number> = {};
  const histMinMax: Record<string, { min: number; max: number }> = {};
  for (const a of attrDefs) {
    if (a.type !== "numeric") continue;
    const vals = pool.map((h) => Number(h.attrs[a.code])).filter((v) => Number.isFinite(v));
    if (vals.length) histMinMax[a.code] = { min: Math.min(...vals), max: Math.max(...vals) };
    const all = [...vals, Number(target[a.code])].filter((v) => Number.isFinite(v));
    ranges[a.code] = all.length ? Math.max(...all) - Math.min(...all) || 1 : 1;
  }

  // Rank by weighted distance. A different line adds a small penalty.
  const ranked = pool
    .map((h) => {
      const { d: base, coverage } = distanceWithCoverage(target, h.attrs, attrDefs, attrW, ranges);
      const d = base + (h.lineId === lineId ? 0 : 0.1);
      // Low coverage means the comparison rests on fewer fields: shrink the similarity accordingly.
      return { h, coverage, sim: similarityFromDistance(d) * (0.5 + 0.5 * coverage) };
    })
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topN);

  const neighbours: Neighbour[] = ranked.map((r, i) => ({
    launchId: r.h.launchId, code: r.h.code, similarity: round(r.sim, 3), rank: i + 1, wasGood: r.h.firstPass, coverage: round(r.coverage, 3),
  }));
  const nMatched = ranked.length;
  const meanSimilarity = nMatched ? ranked.reduce((a, r) => a + r.sim, 0) / nMatched : 0;
  const meanCoverage = nMatched ? ranked.reduce((a, r) => a + r.coverage, 0) / nMatched : 1;

  // Windows per parameter.
  const lines: RecLine[] = [];
  for (const p of paramDefs) {
    const vals: number[] = [];
    const wts: number[] = [];
    for (const r of ranked) {
      const v = r.h.acceptedParams?.[p.code];
      if (v === undefined) continue;
      vals.push(v);
      // Launches that passed first time count fully; reworked ones count 0.7 (their final settings worked, after adjustment).
      wts.push(r.sim * (r.h.firstPass ? 1 : 0.7));
    }
    const cap = lineCaps[p.code] ?? { min: p.absMin, max: p.absMax };
    const range = p.absMax - p.absMin;
    let start: number, low: number, high: number;
    if (vals.length === 0) {
      // No evidence: fall back to the middle fifth of the line capability. Confidence will be Low.
      start = (cap.min + cap.max) / 2;
      low = start - (cap.max - cap.min) * 0.1;
      high = start + (cap.max - cap.min) * 0.1;
    } else {
      const { mean, sd } = weightedStats(vals, wts);
      const sdEff = vals.length === 1 ? 0.02 * range : Math.max(sd, 0.005 * range);
      // Critical parameters get a tighter window: k = 1.5 - 0.15 * level (level 5 -> 0.75 sd, level 3 -> 1.05 sd).
      const k = 1.5 - 0.15 * (paramLevels[p.code] ?? DEFAULT_LEVEL);
      start = mean;
      low = mean - k * sdEff;
      high = mean + k * sdEff;
    }
    let clipped = false;
    let clipReason: string | undefined;
    const clip = (v: number) => Math.min(cap.max, Math.max(cap.min, v));
    if (low < cap.min || high > cap.max || start < cap.min || start > cap.max) {
      clipped = true;
      clipReason = `Limited to line capability ${cap.min} to ${cap.max} ${p.unit}`;
    }
    lines.push({
      code: p.code, startValue: round(clip(start)), windowLow: round(clip(low)), windowHigh: round(clip(high)),
      clipped, clipReason, basedOn: vals.length,
    });
  }

  // Confidence.
  let confidence: Confidence = "Low";
  if (nMatched >= 5 && meanSimilarity >= 0.5) confidence = "High";
  else if (nMatched >= minMatched && meanSimilarity >= 0.3) confidence = "Medium";
  // Thin comparisons cannot be highly confident.
  if (meanCoverage < 0.4) confidence = "Low";
  else if (meanCoverage < 0.7 && confidence === "High") confidence = "Medium";

  // ---- Risk flags ----
  const flags: RiskFlag[] = [];
  if (nMatched < minMatched) {
    flags.push({ type: "low_evidence", severity: "High", message: `Only ${nMatched} similar launches found (minimum ${minMatched}). Treat the window as a rough guide.`, detail: { nMatched } });
  } else if (meanSimilarity < 0.3) {
    flags.push({ type: "low_evidence", severity: "Medium", message: `Matches are distant (mean similarity ${round(meanSimilarity)}).`, detail: { meanSimilarity: round(meanSimilarity) } });
  }

  if (nMatched) {
    const reworked = ranked.filter((r) => r.h.runs > 1);
    const share = reworked.length / nMatched;
    if (share >= 0.3) {
      const counts: Record<string, number> = {};
      reworked.forEach((r) => r.h.reasons.forEach((c) => (counts[c] = (counts[c] ?? 0) + 1)));
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c.replace(/_/g, " "));
      flags.push({
        type: "rework_history",
        severity: share >= 0.5 ? "High" : "Medium",
        message: `${reworked.length} of ${nMatched} similar launches needed rework${top.length ? ` (mostly ${top.join(", ")})` : ""}.`,
        detail: { reworked: reworked.length, nMatched, reasons: counts },
      });
    }
  }

  for (const a of attrDefs) {
    if (a.type !== "numeric") continue;
    const mm = histMinMax[a.code];
    const t = Number(target[a.code]);
    if (!mm || !Number.isFinite(t)) continue;
    const span = mm.max - mm.min || 1;
    if (t > mm.max || t < mm.min) {
      const out = (t > mm.max ? t - mm.max : mm.min - t) / span;
      flags.push({
        type: "out_of_range",
        severity: out > 0.1 ? "High" : "Medium",
        message: `${a.name} ${t}${a.unit ? " " + a.unit : ""} is ${t > mm.max ? "higher" : "lower"} than any past product (${mm.min} to ${mm.max}).`,
        detail: { attr: a.code, target: t, histMin: mm.min, histMax: mm.max },
      });
    }
  }

  for (const p of paramDefs) {
    const level = paramLevels[p.code] ?? DEFAULT_LEVEL;
    if (level < 3) continue;
    const vals = ranked.map((r) => r.h.acceptedParams?.[p.code]).filter((v): v is number => v !== undefined);
    if (vals.length < 3) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    const cap = lineCaps[p.code] ?? { min: p.absMin, max: p.absMax };
    const ratio = sd / ((cap.max - cap.min) || 1);
    if (ratio > 0.12) {
      flags.push({
        type: "spread",
        severity: ratio > 0.2 ? "High" : "Medium",
        message: `Similar launches disagree on ${p.name} (spread ${round(sd)} ${p.unit}).`,
        detail: { parameter: p.code, sd: round(sd), ratio: round(ratio, 3) },
      });
    }
  }

  // Missing data: fields left out of the comparison, fields the target lacks, and thin coverage.
  for (const f of ignoredFields)
    flags.push({ type: "missing_data", severity: "Low", message: `${f.name} is not used for matching yet: ${f.reason}.`, detail: { field: f.code } });
  for (const a of attrDefs) {
    if (target[a.code] === undefined && (attrW[a.code] ?? 0) > 0)
      flags.push({ type: "missing_data", severity: "Medium", message: `This product has no value for ${a.name}, so it is skipped when finding similar launches.`, detail: { field: a.code } });
  }
  if (nMatched && meanCoverage < 0.7)
    flags.push({ type: "missing_data", severity: "Medium", message: `The matches rest on fewer product fields than usual (average ${Math.round(meanCoverage * 100)}% of the weighted fields are known for both products).`, detail: { meanCoverage: round(meanCoverage, 3) } });

  for (const r of rules) {
    if (evalCondition(r.condition, target)) flags.push({ type: "sme_rule", severity: r.severity, message: r.message, smeRuleId: r.id });
  }

  // A parameter added after the history was recorded has no past values: its window is only the middle of the line capability.
  for (const l of lines) {
    if (l.basedOn === 0 && nMatched > 0) {
      const p = paramDefs.find((x) => x.code === l.code)!;
      flags.push({ type: "missing_data", severity: "Medium", message: `No similar launch recorded ${p.name}, so its window is only the middle of the line capability. Treat it as a starting guess.`, detail: { parameter: l.code } });
    }
  }

  const clippedLines = lines.filter((l) => l.clipped);
  if (clippedLines.length) {
    flags.push({
      type: "clipped",
      severity: "Medium",
      message: `${clippedLines.length} setting(s) were limited to line capability: ${clippedLines.map((l) => l.code).join(", ")}.`,
      detail: { parameters: clippedLines.map((l) => l.code) },
    });
  }

  const overallRisk = flags.reduce<Severity>((acc, f) => maxSev(acc, f.severity), "Low");
  if (confidence === "Low" && overallRisk === "Low") {
    // Low confidence is itself a risk, even if nothing else tripped.
  }

  return {
    engineVersion: ENGINE_VERSION, neighbours, lines, confidence, flags, overallRisk, nMatched,
    meanSimilarity: round(meanSimilarity, 3), meanCoverage: round(meanCoverage, 3), ignoredFields,
    normalisedWeights: { attributes: attrW, parameters: paramW },
  };
}

export function smeRuleFromRow(r: { id: string; condition: RuleCondition; risk_effect: { severity?: Severity }; message: string }): SmeRule {
  return { id: r.id, condition: r.condition, severity: r.risk_effect?.severity ?? "Medium", message: r.message };
}

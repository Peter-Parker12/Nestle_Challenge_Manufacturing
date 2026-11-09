export type QualityIn = { code: string; value: number; specMin: number | null; specMax: number | null; critical: boolean };
export type ParamIn = { code: string; actual: number | null; capMin?: number; capMax?: number };

export type RunResult = "Pass" | "Marginal" | "Fail";

/**
 * Derive the run result from quality results (BR-13). The engineer can override only with a reason.
 *  - aborted run                           -> Fail
 *  - any critical test out of spec         -> Fail
 *  - non-critical test out of spec         -> Marginal
 *  - critical test within 5% of its limit -> Marginal
 *  - setting outside line capability       -> Marginal
 *  - otherwise                             -> Pass
 */
export function deriveRunResult(input: { aborted?: boolean; quality: QualityIn[]; params: ParamIn[] }): { result: RunResult; notes: string[] } {
  const notes: string[] = [];
  if (input.aborted) return { result: "Fail", notes: ["Run was aborted"] };
  let result: RunResult = "Pass";
  const bump = (r: RunResult) => {
    const rank = { Pass: 0, Marginal: 1, Fail: 2 } as const;
    if (rank[r] > rank[result]) result = r;
  };
  for (const t of input.quality) {
    const below = t.specMin !== null && t.value < t.specMin;
    const above = t.specMax !== null && t.value > t.specMax;
    if (below || above) {
      notes.push(`${t.code} ${t.value} is ${below ? "below" : "above"} spec (${t.specMin ?? "-"} to ${t.specMax ?? "-"})${t.critical ? " [critical]" : ""}`);
      bump(t.critical ? "Fail" : "Marginal");
      continue;
    }
    if (t.critical) {
      const span = t.specMin !== null && t.specMax !== null ? t.specMax - t.specMin : Math.abs(t.specMax ?? t.specMin ?? 0);
      const margin = 0.05 * span;
      const nearLow = t.specMin !== null && t.value - t.specMin < margin;
      const nearHigh = t.specMax !== null && t.specMax - t.value < margin;
      if (nearLow || nearHigh) {
        notes.push(`${t.code} ${t.value} is within 5% of its limit`);
        bump("Marginal");
      }
    }
  }
  for (const p of input.params) {
    if (p.actual === null || p.capMin === undefined || p.capMax === undefined) continue;
    if (p.actual < p.capMin || p.actual > p.capMax) {
      notes.push(`${p.code} setting ${p.actual} outside line capability (${p.capMin} to ${p.capMax})`);
      bump("Marginal");
    }
  }
  if (!notes.length) notes.push("All quality tests within spec");
  return { result, notes };
}

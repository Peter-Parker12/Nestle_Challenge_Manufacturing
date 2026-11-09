/** Guardrails applied to every Claude output before it reaches a user. */

/** Collect every number that appears anywhere in the context given to Claude. */
export function numbersIn(value: unknown, out = new Set<number>()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) out.add(value);
  else if (typeof value === "string") for (const m of value.matchAll(/-?\d+(?:\.\d+)?/g)) out.add(Number(m[0]));
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

/** Numbers in generated text that do not appear in the context (small whole numbers are ignored). */
export function unverifiedNumbers(text: string, known: Set<number>): string[] {
  const bad: string[] = [];
  const knownArr = [...known];
  for (const m of text.matchAll(/(?<![\w-])-?\d+(?:\.\d+)?/g)) {
    const n = Number(m[0]);
    if (Number.isInteger(n) && Math.abs(n) <= 10) continue;
    const ok = knownArr.some((k) => Math.abs(k - n) <= Math.max(0.011, Math.abs(k) * 0.006));
    if (!ok) bad.push(m[0]);
  }
  return [...new Set(bad)];
}

/** Launch codes like L-1023 cited in text. */
export function citedCodes(text: string): string[] {
  return [...new Set([...text.matchAll(/\b[LDH]-\d{3,4}\b/g)].map((m) => m[0]))];
}

export function invalidCitations(cited: string[], allowed: Set<string>): string[] {
  return cited.filter((c) => !allowed.has(c));
}

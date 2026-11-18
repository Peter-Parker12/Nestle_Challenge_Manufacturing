/** Every [M:..] (move) and [O:..] (observation) tag in an answer must appear in something the tools or the prompt returned (whole-token match). */
export function checkCitations(text: string, source: unknown) {
  const seen = typeof source === "string" ? source : JSON.stringify(source);
  return [...text.matchAll(/\[(M|O|P):([A-Za-z0-9._-]+)\]/g)].map((m) => ({
    tag: m[0], kind: m[1], id: m[2],
    valid: new RegExp(`(^|[^A-Za-z0-9._-])${m[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9._-]|$)`).test(seen),
  }));
}

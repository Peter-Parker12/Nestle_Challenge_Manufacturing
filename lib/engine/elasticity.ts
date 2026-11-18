import { median, type Elast, type Sales } from "./types";

/**
 * Own-price elasticity by ordinary least squares on weeks of sales: ln(units) = a + b ln(price) + c t.
 * Transparent and cheap; not a forecast. When the data cannot support it (too few weeks, no price variation,
 * a positive or negligible fit) the engine says so and uses the configured default.
 */
export function estimateElasticity(rows: Sales[], def: number): Elast {
  const pts = rows.filter((r) => r.units > 0 && r.revenue > 0).sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((r, i) => ({ y: Math.log(r.units), x: Math.log(r.revenue / r.units), t: i }));
  const fallback: Elast = { value: def, low: def * 1.35, high: def * 0.65, method: "default", n: pts.length };
  if (pts.length < 26) return fallback;
  const n = pts.length;
  const sd = Math.sqrt(pts.reduce((s, p) => s + (p.x - pts.reduce((a, q) => a + q.x, 0) / n) ** 2, 0) / n);
  if (sd < 0.01) return fallback; // price barely moved: nothing to learn from
  // normal equations for [1, x, t]
  const X = pts.map((p) => [1, p.x, p.t]);
  const XtX = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const Xty = [0, 1, 2].map((i) => X.reduce((s, r, k) => s + r[i] * pts[k].y, 0));
  const inv = invert3(XtX);
  if (!inv) return fallback;
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  const resid = pts.map((p, k) => p.y - (beta[0] + beta[1] * p.x + beta[2] * p.t));
  const sse = resid.reduce((s, e) => s + e * e, 0);
  const ybar = pts.reduce((s, p) => s + p.y, 0) / n;
  const sst = pts.reduce((s, p) => s + (p.y - ybar) ** 2, 0);
  const r2 = sst > 0 ? 1 - sse / sst : 0;
  const se = Math.sqrt((sse / (n - 3)) * inv[1][1]);
  const b = beta[1];
  if (!(b < -0.3) || b < -4 || r2 < 0.1 || !Number.isFinite(se)) return fallback;
  return { value: b, low: b - 1.96 * se, high: Math.min(b + 1.96 * se, -0.1), method: "log-log", n, r2 } as Elast & { r2: number };
}

function invert3(m: number[][]): number[][] | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
export { median };

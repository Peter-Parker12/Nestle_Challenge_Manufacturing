type P = { week: string; moved: number | null; ours: number | null };

/** Weekly median shelf price of the moved product and of ours, with the competitor's usual range shaded. */
export default function PriceChart({ series, low, high, movedLabel, ourLabel, unitK = true }: { series: P[]; low: number | null; high: number | null; movedLabel: string; ourLabel: string; unitK?: boolean }) {
  const W = 660, H = 270, L = 46, R = 20, T = 16, B = 34;
  const vals = series.flatMap((s) => [s.moved, s.ours]).concat([low, high]).filter((v): v is number => v != null);
  if (vals.length < 2) return <div className="muted">Not enough price history to draw a chart.</div>;
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = (hi0 - lo0) * 0.18 || hi0 * 0.02;
  const lo = lo0 - pad, hi = hi0 + pad;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, series.length - 1);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = (key: "moved" | "ours") => series.map((s, i) => (s[key] == null ? null : `${x(i)},${y(s[key] as number)}`)).filter(Boolean).join(" ");
  const last = series[series.length - 1];
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * k) / 4);
  const fmt = (v: number) => (unitK ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString("en-US"));
  const summary = `${movedLabel} latest ${last.moved != null ? Math.round(last.moved) : "n/a"} VND; ${ourLabel} latest ${last.ours != null ? Math.round(last.ours) : "n/a"} VND; usual range ${low != null && high != null ? `${Math.round(low)} to ${Math.round(high)}` : "n/a"}.`;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} style={{ width: "100%", minWidth: 520, height: "auto", display: "block" }}>
        {low != null && high != null && <rect x={L} y={y(high)} width={W - L - R} height={Math.max(2, y(low) - y(high))} fill="var(--soft)" />}
        {ticks.map((t, k) => <g key={k}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={L - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill="var(--muted)">{fmt(t)}</text></g>)}
        <text x={L} y={H - 10} fontSize="11" fill="var(--muted)">{series[0].week}</text>
        <text x={W - R} y={H - 10} fontSize="11" textAnchor="end" fill="var(--muted)">{last.week}</text>
        <polyline fill="none" stroke="#00b3b0" strokeWidth="2.5" strokeLinejoin="round" points={line("ours")} />
        <polyline fill="none" stroke="#0066e6" strokeWidth="2.5" strokeLinejoin="round" points={line("moved")} />
        {last.moved != null && <circle cx={x(series.length - 1)} cy={y(last.moved)} r="7" fill="#eb222a" stroke="var(--card)" strokeWidth="2" />}
      </svg>
      <div className="row small" style={{ gap: 16, marginTop: 4 }}>
        <span><span style={{ display: "inline-block", width: 14, height: 3, background: "#0066e6", verticalAlign: "middle" }} /> {movedLabel}</span>
        <span><span style={{ display: "inline-block", width: 14, height: 3, background: "#00b3b0", verticalAlign: "middle" }} /> {ourLabel}</span>
        <span><span style={{ display: "inline-block", width: 14, height: 10, background: "var(--soft)", verticalAlign: "middle", border: "1px solid var(--line)" }} /> Usual range</span>
      </div>
    </div>
  );
}

/** Small bar series, oldest to newest. Bars in the accent colour; the last bar is the most recent 7 days. */
export default function Spark({ values, faults, label }: { values: number[]; faults?: number[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div role="img" aria-label={`${label}: ${values.join(", ")}`} style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 34 }}>
      {values.map((v, i) => (
        <div key={i} title={`${v}${faults ? `, ${faults[i]} faults` : ""}`} style={{ width: 9, height: Math.max(2, (v / max) * 34), borderRadius: 2, background: i === values.length - 1 ? "var(--vermilion)" : "var(--teal)", opacity: i === values.length - 1 ? 1 : 0.7 }} />
      ))}
    </div>
  );
}

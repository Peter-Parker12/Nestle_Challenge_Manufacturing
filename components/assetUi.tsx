import Link from "next/link";

export const RATING = ["", "Like new", "Light wear", "Visible wear", "Damaged", "Failed"];
export const ratingClass = (r?: number | null) => (r == null ? "b-gray" : r >= 4 ? "b-red" : r === 3 ? "b-amber" : "b-green");
export const reasonLabel = (s?: string | null) => (s ? s.replace(/_/g, " ") : "");
export const critClass = (c: number) => (c >= 5 ? "b-red" : c === 4 ? "b-amber" : "b-gray");

/** Age against the planned life. The mark is the planned life; this is a fact, not a risk score. */
export function Life({ age, nominal }: { age: number | null; nominal: number | null }) {
  if (age == null || !nominal) return <span className="muted">no seal</span>;
  const scale = Math.max(nominal * 1.4, age);
  const cls = age > nominal ? "over" : age > nominal * 0.85 ? "near" : "";
  return (
    <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
      <div className="life" style={{ flex: 1 }} title={`${age} days of ${nominal} planned`}>
        <i className={cls} style={{ width: `${Math.min(100, (age / scale) * 100)}%` }} />
        <b style={{ left: `${(nominal / scale) * 100}%` }} />
      </div>
      <span className="small" style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{age} / {nominal} d</span>
    </div>
  );
}

export const PosLink = ({ id, children }: { id: string; children: React.ReactNode }) => <Link href={`/assets/positions/${id}`}>{children}</Link>;

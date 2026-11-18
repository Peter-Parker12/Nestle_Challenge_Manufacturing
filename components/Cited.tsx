import Link from "next/link";

/** Text with [M:code] / [O:id] / [P:id] tags. Tags that were not found in the data are shown in red and not linked. */
export default function Cited({ text, invalid = [] }: { text: string; invalid?: string[] }) {
  const bad = new Set(invalid);
  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      {text.split(/(\[(?:M|O|P):[A-Za-z0-9._-]+\])/g).map((p, i) => {
        const t = /^\[(M|O|P):(.+)\]$/.exec(p);
        if (!t) return <span key={i}>{p}</span>;
        if (bad.has(p)) return <span key={i} className="badge b-red" title="This reference was not found in the data it was given">{t[2]} ?</span>;
        return t[1] === "M" ? <Link key={i} className="badge b-blue" href={`/moves/${t[2]}`}>{t[2]}</Link> : <span key={i} className="badge b-gray">{t[1] === "O" ? `obs ${t[2]}` : t[2]}</span>;
      })}
    </span>
  );
}

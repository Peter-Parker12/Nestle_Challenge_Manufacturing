import Link from "next/link";
import BriefActions from "@/components/BriefActions";
import Cited from "@/components/Cited";
import { getBrief, listBriefs } from "@/lib/ai/brief";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function Brief({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const sp = await searchParams;
  const user = await getUser();
  const list = await listBriefs();
  const b: any = await getBrief(sp.id);
  return (
    <>
      <div className="eyebrow">Sales · daily brief</div>
      <h1>Daily brief</h1>
      <p className="sub">A written read of the day&apos;s moves for people who will not open the radar. The numbers come from the engine; Claude writes the words, and every citation is checked against the data it was given. Without an API key a plain standard brief is written instead.</p>
      <div style={{ marginBottom: 14 }}><BriefActions allowed={can(user.role, "refresh")} /></div>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(240px, 1fr)", alignItems: "start" }}>
        {b ? (
          <article className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div><div className="eyebrow">Brief for {b.brief_date}</div><h2 style={{ fontSize: 20, margin: 0 }}>{b.headline}</h2></div>
              <div className="row">
                <span className="badge b-gray">{b.language === "vi" ? "Tiếng Việt" : "English"}</span>
                <span className={`badge ${b.source === "claude" ? "b-blue" : "b-gray"}`}>{b.source === "claude" ? "Written by Claude" : "Standard template"}</span>
                {b.invalid.length === 0 ? <span className="badge b-green">All {b.citations.length} citations verified</span> : <span className="badge b-red">{b.invalid.length} citation{b.invalid.length > 1 ? "s" : ""} not found</span>}
              </div>
            </div>
            {(b.sections as { title: string; text: string }[]).map((s, i) => (
              <div key={i} style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12 }}>
                <h3 style={{ margin: 0 }}>{s.title}</h3>
                <p style={{ margin: "6px 0 0", lineHeight: 1.7 }}><Cited text={s.text} invalid={b.invalid} /></p>
              </div>
            ))}
            {b.invalid.length > 0 && <div className="msg warn">Not found in the data: {(b.invalid as string[]).join(", ")}. Treat those references as unverified.</div>}
          </article>
        ) : <section className="card"><p className="muted">No brief yet. Write today&apos;s brief.</p></section>}
        <section className="card">
          <h2>Earlier briefs</h2>
          {list.length === 0 && <p className="muted">None yet.</p>}
          {list.map((x: any) => (
            <div key={x.id} className="row" style={{ justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
              <Link href={`/brief?id=${x.id}`}>{x.brief_date} · {x.headline.slice(0, 40)}</Link>
              <span className={`badge ${x.n_invalid > 0 ? "b-amber" : "b-green"}`}>{x.n_invalid > 0 ? `${x.n_invalid} flagged` : "Verified"}</span>
            </div>
          ))}
          <div className="small muted" style={{ marginTop: 8 }}>Briefs are kept and never edited.</div>
        </section>
      </div>
    </>
  );
}

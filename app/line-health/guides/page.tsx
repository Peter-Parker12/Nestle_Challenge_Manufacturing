import GuideForm from "@/components/GuideForm";
import { can } from "@/lib/permissions";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Guides({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const user = await getUser();
  const guides = await q(`select code, title, alarm_codes, keywords, steps, source, status from ops.guide order by code`);
  return (
    <>
      <div className="eyebrow">Line health · DNF-2</div>
      <h1>Troubleshooting guides</h1>
      <p className="sub">Expert-written steps for the alarms the filler raises. The Hey, Filler assistant quotes these steps and cites them; it does not write its own. Guides are retired, never deleted.</p>
      {can(user.role, "manageGuides") && <GuideForm />}
      <div className="card">
        {guides.map((g) => (
          <details key={g.code} open={g.code === code} id={g.code} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
            <summary><strong>{g.code}</strong> · {g.title} <span className="muted small">{(g.alarm_codes as string[]).join(", ")}</span></summary>
            <ol>{(g.steps as any[]).map((s) => <li key={s.n}>{s.text}</li>)}</ol>
            <p className="small muted">Source: {g.source ?? "not stated"} · keywords: {(g.keywords as string[]).join(", ")}</p>
          </details>
        ))}
      </div>
    </>
  );
}

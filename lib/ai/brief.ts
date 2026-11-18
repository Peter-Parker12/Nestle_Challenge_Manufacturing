import { z } from "zod";
import { HttpError } from "../auth";
import { q, q1 } from "../db";
import { getMove, latestDate, listMoves } from "../radar";
import { aiEnabled, models, structured } from "./client";
import { checkCitations } from "./cite";

/**
 * The daily brief: a written read of the day's moves. Claude writes the words; the numbers come from the engine and are
 * handed to it. Citations [M:code] and [O:id] are checked against what it was given; unverifiable ones are stored and flagged.
 * Without a key a plain deterministic template is used, so the brief always exists.
 */
const TOOL = {
  name: "write_brief",
  description: "Write the daily market brief.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      sections: { type: "array", items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"] } },
    },
    required: ["headline", "sections"],
  },
};
const Out = z.object({ headline: z.string().min(5).max(200), sections: z.array(z.object({ title: z.string().max(80), text: z.string().min(10).max(1800) })).min(1).max(6) });

const vnd = (n: number) => (n >= 1e9 ? `VND ${(n / 1e9).toFixed(1)}B` : `VND ${Math.round(n / 1e6)}M`);

async function facts() {
  const asOf = await latestDate();
  const moves = (await listMoves({})).filter((m) => m.status === "Open").slice(0, 8);
  const detail = [];
  for (const m of moves) {
    const d = await getMove(m.code);
    detail.push({
      code: m.code, kind: m.kind, level: m.level, title: m.title, channel: m.channel_name, change_pct: m.change_pct != null ? Number(m.change_pct) : null,
      coverage: Number(m.coverage), exposure_per_week_vnd: { mid: m.exposure_vnd, low: m.exposure_low, high: m.exposure_high },
      nestle_volume_vs_usual_pct: d.volume.changePct,
      evidence_observation_ids: d.evidence.filter((e: any) => e.obsId).map((e: any) => e.obsId),
      scenarios: d.scenarios.map((s: any) => ({ label: s.label, title: s.title, volume_pct: s.volume_pct, volume_range: [s.volume_low, s.volume_high], margin_vnd_per_week: s.margin_vnd_wk, confidence: s.confidence, needs_category_manager: s.needs_category_manager })),
    });
  }
  return { asOf, moves: detail };
}

function template(f: Awaited<ReturnType<typeof facts>>, lang: "en" | "vi") {
  const high = f.moves.filter((m) => m.level === "High");
  const total = f.moves.filter((m) => m.kind !== "price_rise").reduce((s, m) => s + m.exposure_per_week_vnd.mid, 0);
  const vi = lang === "vi";
  const headline = vi ? (high.length ? `${high.length} biến động giá cần quyết định trong tuần này` : "Không có biến động lớn hôm nay") : high.length ? `${high.length} market move${high.length > 1 ? "s" : ""} need a decision this week` : "No major market moves today";
  const sections = [
    { title: vi ? "Tóm tắt" : "Summary", text: vi ? `${f.moves.length} biến động đang mở, ước tính ${vnd(total)} doanh thu mỗi tuần có rủi ro. ${f.moves.slice(0, 3).map((m) => `[M:${m.code}]`).join(" ")}` : `${f.moves.length} open moves, about ${vnd(total)} a week of Nestlé sales at risk. ${f.moves.slice(0, 3).map((m) => `[M:${m.code}]`).join(" ")}` },
    ...f.moves.slice(0, 5).map((m) => ({ title: `${m.code} · ${m.level}`, text: `${m.title}. ${vi ? "Rủi ro" : "Exposure"} ${vnd(m.exposure_per_week_vnd.mid)} (${vnd(m.exposure_per_week_vnd.low)} - ${vnd(m.exposure_per_week_vnd.high)}). [M:${m.code}]` })),
    { title: vi ? "Lưu ý" : "What this brief does not say", text: vi ? "Con số là ước tính có khoảng, từ mô hình co giãn giá. Chưa có gì được phê duyệt hay thay đổi." : "Figures are estimates with ranges from a price-elasticity model. Nothing here has been approved or changed." },
  ];
  return { headline, sections };
}

export async function generateBrief(userId: string | null, language: "en" | "vi") {
  const f = await facts();
  if (!f.asOf) throw new HttpError(409, "There is no data yet", "conflict");
  let out: { headline: string; sections: { title: string; text: string }[] }, source: "claude" | "template" = "template";
  if (aiEnabled()) {
    const system = `You write the daily brief for Nestlé Vietnam's Sales team from the market data given. Write in ${language === "vi" ? "Vietnamese" : "English"}.
Rules: use only the numbers and facts in <data>; do not invent figures; cite each claim with [M:move code] and, when you rely on a specific price, [O:observation id], only ids that appear in the data. State exposures as estimates with their range. You can recommend a scenario; you cannot approve, change a price or promise a result. Put what is uncertain in the last section. Be short: a headline and 3 to 5 short sections, most urgent first.`;
    const r = await structured({ purpose: "daily_brief", model: models.main(), system, tool: TOOL, zod: Out, userId, maxTokens: 2500, content: `<data>${JSON.stringify(f)}</data>`, inputRefs: { moves: f.moves.map((m) => m.code), as_of: f.asOf } });
    if (r.valid && r.data) { out = r.data; source = "claude"; } else out = template(f, language);
  } else out = template(f, language);
  const text = out.headline + " " + out.sections.map((s) => s.text).join(" ");
  const cites = checkCitations(text, JSON.stringify(f));
  const row = await q1<{ id: string }>(
    `insert into mkt.brief(brief_date,language,headline,sections,citations,invalid,source,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [f.asOf, language, out.headline, JSON.stringify(out.sections), JSON.stringify(cites), JSON.stringify(cites.filter((c) => !c.valid).map((c) => c.tag)), source, userId]);
  return { id: row!.id, source };
}

export async function listBriefs() { return q(`select id, brief_date, language, headline, source, jsonb_array_length(invalid) as n_invalid, jsonb_array_length(citations) as n_cites, created_at from mkt.brief order by brief_date desc, created_at desc limit 30`); }
export async function getBrief(id?: string) {
  const b = id ? await q1(`select * from mkt.brief where id=$1`, [id]) : await q1(`select * from mkt.brief order by brief_date desc, created_at desc limit 1`);
  if (!b && id) throw new HttpError(404, "Brief not found", "not_found");
  return b;
}

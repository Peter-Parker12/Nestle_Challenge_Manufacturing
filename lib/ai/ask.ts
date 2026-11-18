import { z } from "zod";
import { HttpError } from "../auth";
import { q, q1 } from "../db";
import { getMove, listMoves } from "../radar";
import { models, toolLoop } from "./client";
import { checkCitations } from "./cite";

/**
 * "Ask the radar": read-only tools over moves, price history and shelf readings. It cannot decide, accept or change anything.
 * Citations [M:code] and [O:id] are checked against what the tools returned; unverifiable ones are flagged on screen.
 */
const TOOLS = [
  { name: "get_moves", description: "List the detected market moves with level, change, exposure per week and status. Optional filter by level (High, Medium, Low) or channel code (GT, MT, ECOM).",
    input_schema: { type: "object", properties: { level: { type: "string" }, channel: { type: "string" } } } },
  { name: "get_move", description: "One move by code (for example M-2002): evidence with observation ids, the response scenarios with volume and margin estimates, and decisions.",
    input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
  { name: "get_price_history", description: "Weekly median shelf price of a SKU in a channel for the last N weeks (default 12). Use the SKU code from get_moves or get_skus.",
    input_schema: { type: "object", properties: { sku: { type: "string" }, channel: { type: "string" }, weeks: { type: "number" } }, required: ["sku", "channel"] } },
  { name: "get_skus", description: "List SKUs (code, name, brand, Nestlé or competitor, competes with) and channels.", input_schema: { type: "object", properties: {} } },
];
const SYSTEM = `You are "Ask the radar", an assistant for Nestlé Vietnam's Sales team. You answer questions about price, promo, pack and shelf moves in general trade, modern trade and eCom.
Rules:
1. Use the tools. State only facts that the tools returned; if the data does not say, say so (for example the data has channels, not cities).
2. Cite what you rely on: [M:move code] and [O:observation id]. Do not invent codes.
3. You can recommend; you cannot accept a scenario, change a price or promise a result. People decide.
4. Impact figures are estimates with ranges from a price-elasticity model; say so.
5. Answer first, then the evidence. Be short. Reply in the language the user writes in (English or Vietnamese).`;

async function run(name: string, input: any) {
  if (name === "get_moves") {
    const ms = (await listMoves({})).filter((m) => (!input?.level || m.level === input.level) && (!input?.channel || m.channel_code === String(input.channel).toUpperCase()));
    return ms.map((m) => ({ code: m.code, kind: m.kind, level: m.level, title: m.title, channel: m.channel_code, change_pct: m.change_pct, coverage: m.coverage, exposure_per_week_vnd: m.exposure_vnd, range: [m.exposure_low, m.exposure_high], status: m.status, sku: m.sku_code, nestle_sku: m.nestle_code }));
  }
  if (name === "get_move") {
    const d = await getMove(String(input?.code ?? "").trim());
    return {
      code: d.move.code, title: d.move.title, level: d.move.level, status: d.move.status, exposure_per_week_vnd: d.move.exposure_vnd, range: [d.move.exposure_low, d.move.exposure_high],
      nestle_volume_vs_usual_pct: d.volume.changePct, elasticity: d.elasticity,
      evidence: d.evidence.map((e: any) => ({ fact: e.fact, observation_id: e.obsId ?? null, retailer: e.obs?.retailer, on: e.obs?.observed_on })),
      scenarios: d.scenarios.map((s: any) => ({ label: s.label, title: s.title, volume_pct: s.volume_pct, volume_range: [s.volume_low, s.volume_high], margin_vnd_per_week: s.margin_vnd_wk, cost: s.cost_text, risk: s.risk_text, confidence: s.confidence })),
      decisions: d.decisions.map((x: any) => ({ action: x.action, scenario: x.label, by: x.by_name, reason: x.reason })),
    };
  }
  if (name === "get_price_history") {
    const sku = await q1<{ id: string }>(`select id from mkt.sku where upper(code)=upper($1)`, [String(input?.sku ?? "")]);
    const ch = await q1<{ id: string }>(`select id from cfg.channel where upper(code)=upper($1)`, [String(input?.channel ?? "")]);
    if (!sku || !ch) return { error: "Unknown SKU or channel. Use get_skus." };
    const weeks = Math.min(Math.max(Number(input?.weeks) || 12, 2), 52);
    return q(`select d.wk::date as week, (select round(percentile_cont(0.5) within group (order by o.price)::numeric) from mkt.observation o where o.sku_id=$1 and o.channel_id=$2 and o.observed_on between d.wk::date and d.wk::date + 6) as median_price
      from generate_series((select max(observed_on) from mkt.observation) - ($3::int * 7), (select max(observed_on) from mkt.observation), interval '7 days') d(wk) order by 1`, [sku.id, ch.id, weeks]);
  }
  if (name === "get_skus") return { skus: await q(`select s.code, s.name, s.brand, s.is_nestle, n.code as competes_with from mkt.sku s left join mkt.sku n on n.id=s.competes_with order by s.code`), channels: await q(`select code, name from cfg.channel order by code`) };
  return { error: "Unknown tool" };
}

export const askInput = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).min(1).max(12) });

export async function askRadar(userId: string, input: z.infer<typeof askInput>) {
  const last = input.messages[input.messages.length - 1];
  if (last.role !== "user") throw new HttpError(422, "The last message must be from the user", "validation");
  const history = input.messages.slice(0, -1).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const question = (history ? `Conversation so far:\n${history}\n\n` : "") + `<data>${last.content}</data>`;
  const out = await toolLoop({ purpose: "ask_radar", model: models.main(), system: SYSTEM, question, tools: TOOLS as any, userId, maxRounds: 6, run });
  const cites = checkCitations(out.text, out.toolCalls.map((t) => t.output));
  return { text: out.text, citations: cites, invalid: cites.filter((c) => !c.valid).map((c) => c.tag), tools: out.toolCalls.map((t) => t.name) };
}
void q;

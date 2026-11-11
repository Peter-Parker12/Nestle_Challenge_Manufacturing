import { z } from "zod";
import { HttpError } from "../auth";
import { q1 } from "../db";
import { launchLineContext, plantStatus } from "../plant";
import { getLaunchDetail } from "../repo";
import { riskBoard, summarise } from "../risk";
import { models, toolLoop } from "./client";
import { FILLER_TOOLS, checkCitations, run as runFiller } from "./hey";
import { listFillers } from "../linehealth";

/**
 * "Ask the plant": one chat over launches, seals and filler health, for questions that cross modules
 * ("can I run the L-1060 trial on L1 next week?"). Read-only tools; every claim cites what a tool returned.
 * Citations: [L:launch code], [P:part code], [A:alarm code], [G:guide code], each checked against the tool outputs.
 */
const TOOLS = [
  { name: "get_plant_status", description: "Status of every line: state (Attention/Watch/OK), reasons, seals at High risk, filler station that needs attention, next planned stop and open launches. Call this first for any cross-module question.",
    input_schema: { type: "object", properties: {} } },
  { name: "get_seal_risk", description: "Seals ranked by risk score with the main factors, projected date of reaching High, and the recommended stop. Optional line code filter.",
    input_schema: { type: "object", properties: { line: { type: "string", description: "Line code such as L1" }, limit: { type: "number" } } } },
  { name: "get_launch", description: "One launch by code (for example L-1060): product, line, status, trial runs and results, and what is known about the line it will run on (line status, planned stops, advice).",
    input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
  ...FILLER_TOOLS,
];

const SYSTEM = `You are "Ask the plant", an assistant for a Nestlé Vietnam UHT plant. You answer questions that cross three areas: new product launches (BAF-1), seals and gaskets (BAF-2) and filler health (DNF-2).
Rules:
1. Use the tools. State only facts that the tools returned; if the data does not say, say so.
2. Cite what you rely on: [L:launch code], [P:part code], [A:alarm code], [G:guide code]. Do not invent codes.
3. You can recommend; you cannot approve, schedule, change a setting or close an alert, and must never say that you did. People decide.
4. Troubleshooting steps come only from the guides. Never suggest bypassing a guard or interlock.
5. Risk scores and stop predictions are trends and rules from this plant's own history, not certainties. Say that when it matters.
6. Answer first, then the evidence. Be short and prioritised. Reply in the language the user writes in (English or Vietnamese).`;

async function run(name: string, input: any, fillerId: string) {
  if (name === "get_plant_status") {
    const { lines } = await plantStatus();
    return lines.map((l) => ({ line: l.code, state: l.state, reasons: l.reasons, seals_high: l.seals.high, seals_medium: l.seals.medium, high_without_planned_stop: l.seals.highWithoutStop,
      worst_seal: l.seals.worst?.label ?? null, filler_station: l.filler ? `${l.filler.station} (${l.filler.level}, score ${l.filler.score})` : null, filler_prediction: l.filler?.prediction ?? null,
      next_planned_stop: l.nextStop, open_launches: l.launches.map((x) => ({ launch: x.code, product: x.product, status: x.status })) }));
  }
  if (name === "get_seal_risk") {
    const r = await riskBoard();
    const lim = Math.min(Math.max(Number(input?.limit) || 8, 1), 15);
    return r.ranked.filter((x) => !input?.line || x.lineCode === String(input.line).toUpperCase()).slice(0, lim).map((x) => ({
      line: x.lineCode, position: `${x.assembly} · ${x.positionName}`, part: x.partCode, score: x.result.score, level: x.result.level,
      reaches_high_on: x.projectedHighOn, recommended_stop: x.recommendedStop, why: summarise(x, x.projectedDays),
    }));
  }
  if (name === "get_launch") {
    const l = await q1<{ id: string }>("select id from core.launch_project where code=$1", [String(input?.code ?? "").trim()]);
    if (!l) return { error: "No such launch" };
    const [d, ctx] = await Promise.all([getLaunchDetail(l.id), launchLineContext(l.id)]);
    return {
      launch: d.launch.code, product: d.launch.productName, line: d.launch.line, status: d.launch.status, technical_acceptance: d.launch.taDecision ?? null,
      runs: d.runs.map((r) => ({ run: r.runNo, status: r.status, result: r.result })),
      line_context: ctx ? { state: ctx.line.state, reasons: ctx.line.reasons, next_planned_stop: ctx.line.nextStop, advice: ctx.advice } : null,
    };
  }
  return runFiller(name, input, fillerId);
}

export const plantChatInput = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).min(1).max(12),
});

export async function askPlant(userId: string, input: z.infer<typeof plantChatInput>) {
  const last = input.messages[input.messages.length - 1];
  if (last.role !== "user") throw new HttpError(422, "The last message must be from the user", "validation");
  const f = (await listFillers())[0];
  const history = input.messages.slice(0, -1).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const question = (history ? `Conversation so far:\n${history}\n\n` : "") + `<data>${last.content}</data>`;
  const out = await toolLoop({
    purpose: "ask_plant", model: models.main(), system: SYSTEM, question, tools: TOOLS as any, userId, maxRounds: 6,
    run: (name, i) => run(name, i, f?.id ?? ""),
  });
  const cites = checkCitations(out.text, out.toolCalls);
  return { text: out.text, citations: cites, invalid: cites.filter((c) => !c.valid).map((c) => c.tag), tools: out.toolCalls.map((t) => t.name) };
}

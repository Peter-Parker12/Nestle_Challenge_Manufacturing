import { z } from "zod";
import { HttpError } from "../auth";
import { q, q1 } from "../db";
import { fillerHealth, listFillers, stationDetail } from "../linehealth";
import { models, toolLoop } from "./client";

/**
 * "Hey, Filler": a chat assistant over the filler's health, alarms, seals and troubleshooting guides.
 * Read-only tools, row-capped. It can recommend; it has no tool that changes anything. Troubleshooting steps come only from the guides.
 * Answers cite [A:alarm code], [G:guide code] and [P:part code]; each citation is checked against what the tools returned.
 */
export const FILLER_TOOLS = [
  { name: "get_health", description: "Prioritised health of the filler: KPIs and every station ranked by attention score, with the evidence, stop prediction, linked seal and next actions. Call this first for any 'what is wrong' or 'what should I do' question.",
    input_schema: { type: "object", properties: { filler: { type: "string", description: "Line code such as L1. Omit for the current filler." } } } },
  { name: "get_station", description: "Detail for one station: alarms by code (30 days), breakdowns, open maintenance, settings with approved limits, seals in the assembly and matching troubleshooting guides with their steps.",
    input_schema: { type: "object", properties: { station: { type: "string", description: "Station code, for example V3" }, filler: { type: "string" } }, required: ["station"] } },
  { name: "find_guides", description: "Search troubleshooting guides by alarm code, symptom or keyword. Returns the full steps.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
];

const SYSTEM = (filler: string) => `You are "Hey, Filler", an assistant for operators, maintenance, quality and engineers working on the filler (${filler}).
Rules:
1. Use the tools. State only facts that the tools returned; if the data does not say, say so.
2. Cite what you rely on with tags: [A:alarm code], [G:guide code], [P:part code]. Do not invent codes.
3. Troubleshooting steps come only from the guides, in their order, with the guide's lockout and safety step included as written. If no guide covers the problem, say so and suggest asking maintenance. Never suggest bypassing a guard or interlock.
4. You cannot change anything and must never say that you did. A setting can be returned to its target only by a person; say so.
5. Stop predictions are a trend based on earlier stops at this machine, not a certainty. Say that.
6. Answer first, then the evidence. Be short and prioritised. Reply in the language the user writes in (English or Vietnamese).`;

export const heyEnabled = true;

async function resolveFiller(code?: string) {
  const fillers = await listFillers();
  return fillers.find((f) => f.line_code === code) ?? fillers[0];
}

export async function run(name: string, input: any, fillerId: string) {
  const f = input?.filler ? await resolveFiller(String(input.filler)) : { id: fillerId };
  if (name === "get_health") {
    const h = await fillerHealth(f.id);
    return {
      filler: `${h.filler.line_code}/${h.filler.code}`, kpis_last_7_days_vs_usual: h.kpis, faults_before_earlier_stops: h.threshold,
      stations: h.stations.slice(0, 6).map((s) => ({
        station: s.code, name: s.name, score: s.score, level: s.level, top_alarm: s.topAlarm, stop_prediction: s.prediction.text,
        seal: s.seal, evidence: s.factors.filter((x) => x.points > 0).map((x) => `${x.label}: ${x.note}`), next_actions: s.actions.map((a) => a.text),
      })),
    };
  }
  if (name === "get_station") {
    const st = await q1<{ id: string }>(`select s.id from ops.station s where s.equipment_id=$1 and upper(s.code)=upper($2)`, [f.id, String(input.station)]);
    if (!st) return { error: "No such station" };
    const d = await stationDetail(st.id);
    return {
      station: d.station.code, name: d.station.name, score: d.health.score, level: d.health.level, prediction: d.health.prediction.text,
      alarms_30_days: d.byCode.map((a) => ({ code: a.code, description: a.description, count: a.n, faults: a.faults })),
      breakdowns: d.breakdowns.slice(0, 4).map((b) => ({ when: b.started_at, minutes: b.minutes, cause: b.cause, fix: b.fix })),
      open_maintenance: d.tasks.filter((t) => !t.done_on).map((t) => ({ title: t.title, due: t.due_on, overdue: t.overdue })),
      settings: d.settings.map((s) => ({ name: s.name, unit: s.unit, current: Number(s.current_value), target: Number(s.target), approved_min: Number(s.min_value), approved_max: Number(s.max_value) })),
      seals: d.health.seal, guides: d.guides.map((g) => ({ code: g.code, title: g.title, alarm_codes: g.alarm_codes, steps: (g.steps as any[]).map((x) => x.text) })),
    };
  }
  if (name === "find_guides") {
    const term = `%${String(input.query ?? "").slice(0, 60)}%`;
    const rows = await q(
      `select code, title, alarm_codes, steps from ops.guide where status='Active' and (code ilike $1 or title ilike $1 or exists (select 1 from unnest(keywords) k where k ilike $1) or exists (select 1 from unnest(alarm_codes) a where a ilike $1)) limit 5`, [term]);
    return rows.map((g) => ({ code: g.code, title: g.title, alarm_codes: g.alarm_codes, steps: (g.steps as any[]).map((x) => x.text) }));
  }
  return { error: "Unknown tool" };
}

/** Every [A:..] [G:..] [P:..] [L:..] tag must appear in something a tool returned (whole-token match). */
export function checkCitations(text: string, toolCalls: { output: unknown }[]) {
  const seen = JSON.stringify(toolCalls.map((t) => t.output));
  return [...text.matchAll(/\[(A|G|P|L):([A-Za-z0-9._-]+)\]/g)].map((m) => ({
    tag: m[0], kind: m[1], id: m[2],
    valid: new RegExp(`(^|[^A-Za-z0-9._-])${m[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9._-]|$)`).test(seen),
  }));
}

export const chatInput = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).min(1).max(12),
  filler: z.string().uuid().optional(),
});

export async function askFiller(userId: string, input: z.infer<typeof chatInput>) {
  const last = input.messages[input.messages.length - 1];
  if (last.role !== "user") throw new HttpError(422, "The last message must be from the user", "validation");
  const f = input.filler ? (await listFillers()).find((x) => x.id === input.filler) : (await listFillers())[0];
  if (!f) throw new HttpError(404, "Filler not found", "not_found");
  const history = input.messages.slice(0, -1).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const question = (history ? `Conversation so far:\n${history}\n\n` : "") + `<data>${last.content}</data>`;
  const out = await toolLoop({
    purpose: "hey_filler", model: models.main(), system: SYSTEM(`${f.line_code}/${f.code}`), question, tools: FILLER_TOOLS as any, userId, maxRounds: 5,
    run: (name, i) => run(name, i, f.id), inputRefs: { filler: f.id },
  });
  const cites = checkCitations(out.text, out.toolCalls);
  return {
    text: out.text, citations: cites, invalid: cites.filter((c) => !c.valid).map((c) => c.tag),
    tools: out.toolCalls.map((t) => t.name),
  };
}

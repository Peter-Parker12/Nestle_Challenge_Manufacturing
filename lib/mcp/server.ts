import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AiUnavailable, aiEnabled } from "../ai/client";
import { askHistory, explainRecommendation } from "../ai/features";
import { HttpError } from "../auth";
import { q, q1 } from "../db";
import { type Action, can, type Role } from "../permissions";
import { fillerHealth, listFillers } from "../linehealth";
import { launchLineContext, plantStatus } from "../plant";
import { riskBoard, summarise } from "../risk";
import {
  createLaunch, createRecommendation, dashboardKpis, getLaunchDetail, listCategories, listLaunches, listLines, loadCategoryConfig, previewRecommendation,
} from "../repo";

/**
 * Tools that Microsoft Copilot (or any MCP client) can call.
 *
 * What Copilot can do: look things up, draft a launch, ask for a recommendation, ask why, preview the effect of weights, ask about history.
 * What it cannot do, by design: approve or reject a plan, enter or review run results, record technical acceptance, change weights, fields or setup.
 * Those stay with people in the web app. Every tool that writes returns a link to the launch so a person can review and decide.
 *
 * Fields marked "never shared with AI" are left out of everything returned here, and cannot be written through this endpoint.
 */
export type McpCtx = { userId: string; role: Role; baseUrl: string };

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

const KEY = z.union([z.string(), z.number(), z.boolean()]);

export function buildServer(ctx: McpCtx): McpServer {
  const server = new McpServer({ name: "launch-accelerator", version: "1.0.0" }, {
    instructions:
      "Launch Accelerator (BAF-1) recommends a starting recipe and process window for new product launches from similar past launches. " +
      "Start with get_category_setup to learn the fields and units. For plant questions use get_plant_status, get_seal_risk and get_filler_health (read-only). Use create_launch to draft a launch and recommend to request a proposal. " +
      "Recommendations are proposals: a person must review and approve them in the web app, using the link returned. Never claim a plan is approved.",
  });

  const link = (id: string) => `${ctx.baseUrl}/launches/${id}`;

  function add<S extends z.ZodRawShape>(
    name: string,
    cfg: { title: string; description: string; schema: S; write?: boolean; needs?: Action },
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) {
    server.registerTool(
      name,
      { title: cfg.title, description: cfg.description, inputSchema: cfg.schema, annotations: { readOnlyHint: !cfg.write, destructiveHint: false, idempotentHint: !cfg.write, openWorldHint: false } },
      (async (args: z.infer<z.ZodObject<S>>) => {
        try {
          if (cfg.needs && !can(ctx.role, cfg.needs)) return fail(`The Copilot service account has the role "${ctx.role.replace("_", " ")}", which is not allowed to do this. Ask an administrator to change MCP_SERVICE_ROLE if it should.`);
          // Every call is recorded with the service account, the tool and (trimmed) arguments.
          await q("insert into audit.event(user_id, action, entity, entity_id, after, reason) values ($1,'MCP_TOOL','mcp.tool',$2,$3,'Called by an AI assistant through MCP')",
            [ctx.userId, name, JSON.stringify({ args: JSON.stringify(args).slice(0, 2000) })]);
          return ok(await run(args));
        } catch (e: any) {
          if (e instanceof HttpError) return fail(e.message);
          if (e instanceof AiUnavailable) return fail("This feature needs the Claude API, which is not configured on this server.");
          console.error(`[mcp] ${name} failed`, e);
          return fail("Something went wrong on the server. Nothing was changed unless the response says so.");
        }
      }) as any,
    );
  }

  /* ---- helpers ---- */
  async function categoryId(input?: string) {
    if (!input) throw new HttpError(422, "Say which category. Use get_category_setup without arguments to list them.", "validation");
    const c = await q1<{ id: string }>("select id from cfg.category where active and (lower(code)=lower($1) or lower(name)=lower($1))", [input.trim()]);
    if (!c) throw new HttpError(404, `No category "${input}". Use get_category_setup without arguments to list them.`, "not_found");
    return c.id;
  }
  async function lineId(input: string) {
    const l = await q1<{ id: string }>("select id from cfg.line where lower(code)=lower($1) or lower(name)=lower($1)", [input.trim()]);
    if (!l) throw new HttpError(404, `No line "${input}". Valid lines: ${(await listLines()).map((x: any) => x.code).join(", ")}.`, "not_found");
    return l.id;
  }
  async function launchId(input: string) {
    const l = await q1<{ id: string }>("select id from core.launch_project where code=$1 or id::text=$1", [input.trim()]);
    if (!l) throw new HttpError(404, `No launch "${input}". Use list_launches to find launch codes such as L-1060.`, "not_found");
    return l.id;
  }

  /** A launch as an assistant should see it: no hidden fields, readable names, a link for the human. */
  function describe(d: Awaited<ReturnType<typeof getLaunchDetail>>) {
    const visible = d.attrDefs.filter((a: any) => a.aiVisible !== false);
    const pName = new Map(d.paramDefs.map((p) => [p.code, p]));
    const rec = d.recommendations[0];
    return {
      launch: d.launch.code, status: d.launch.status, product: d.launch.productName, category: d.launch.category, line: d.launch.line,
      technical_acceptance: d.launch.taDecision ?? null, review_and_decide_here: link(d.launch.id),
      product_fields: visible.filter((a: any) => d.attrs[a.code] !== undefined).map((a: any) => ({ code: a.code, name: a.name, value: d.attrs[a.code], unit: a.unit ?? undefined, affects_matching: (a.kind ?? "matching") === "matching" })),
      quality_targets: d.specs.filter((s: any) => s.spec_min !== null || s.spec_max !== null).map((s: any) => ({ test: s.code, name: s.name, min: s.spec_min === null ? null : Number(s.spec_min), max: s.spec_max === null ? null : Number(s.spec_max), critical: s.is_critical })),
      runs: d.runs.map((r) => ({ run: r.runNo, status: r.status, result: r.result, loss_kg: r.lossKg, next_step: r.nextStep, reasons: r.reasons.map((x) => x.label) })),
      latest_recommendation: rec ? {
        for_run: rec.runNoTarget, confidence: rec.confidence, overall_risk: rec.overallRisk, similar_launches_used: rec.nMatched,
        decision: rec.decision ? { action: rec.decision.action, by: rec.decision.by } : "waiting for a person to decide",
        settings: rec.lines.map((l) => ({ parameter: l.code, name: pName.get(l.code)?.name, unit: pName.get(l.code)?.unit, start: l.startValue, window: [l.windowLow, l.windowHigh], limited_to_line_capability: l.clipped })),
        risk_flags: rec.flags.map((f) => ({ severity: f.severity, type: f.type, message: f.message })),
        evidence: rec.evidence.slice(0, 10).map((e) => ({ launch: e.code, product: e.productName, similarity: e.similarity, passed_first_run: e.wasGood })),
      } : null,
    };
  }

  /* ---- tools ---- */
  add("get_category_setup", {
    title: "Get category setup",
    description: "List the product categories, or with a category code return what it needs to describe a launch: the product fields (with types, units, options, allowed ranges and whether they are required), the quality tests, the process parameters and the lines. Call this before create_launch.",
    schema: { category: z.string().max(60).optional().describe("Category code, for example UHT_DRINK. Leave out to list all categories.") },
  }, async ({ category }) => {
    if (!category) return { categories: (await listCategories()).map((c: any) => ({ code: c.code, name: c.name })), next: "Call get_category_setup again with a category code." };
    const id = await categoryId(category);
    const cfg = await loadCategoryConfig(id);
    return {
      category,
      product_fields: cfg.attrDefs.filter((a) => a.aiVisible !== false).map((a) => ({
        code: a.code, name: a.name, type: a.type, unit: a.unit ?? undefined, required: a.required, options: a.type === "choice" ? a.choices : undefined,
        allowed_range: a.type === "numeric" ? [a.absMin, a.absMax] : undefined, help: a.helpText ?? undefined, affects_matching: (a.kind ?? "matching") === "matching",
      })),
      quality_tests: cfg.tests.map((t) => ({ code: t.code, name: t.name, unit: t.unit ?? undefined, critical: t.is_critical })),
      process_parameters: cfg.paramDefs.map((p) => ({ code: p.code, name: p.name, unit: p.unit, allowed_range: [p.absMin, p.absMax], critical: p.isCritical, locked_limits: p.isLocked })),
      lines: (await listLines()).map((l: any) => ({ code: l.code, name: l.name })),
      note: "Yes/no fields take true or false. Dates are YYYY-MM-DD. quality_targets in create_launch use the quality test codes.",
    };
  });

  add("list_launches", {
    title: "List launches",
    description: "List product launches, newest first, with their status, number of runs and latest result. Use the launch code (for example L-1060) in other tools.",
    schema: {
      status: z.enum(["Draft", "Recommended", "In review", "Approved", "Trial running", "Results entered", "Closed", "Cancelled"]).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
  }, async ({ status, limit }) => {
    const rows = (await listLaunches()) as any[];
    const out = rows.filter((l) => !status || l.status === status).slice(0, limit);
    return { count: out.length, launches: out.map((l) => ({ launch: l.code, product: l.product, category: l.category, line: l.line, status: l.status, runs: l.runs, last_result: l.last_result ?? null, technical_acceptance: l.ta_decision ?? null, url: link(l.id) })) };
  });

  add("get_launch", {
    title: "Get a launch",
    description: "Everything about one launch: product fields, quality targets, trial runs and results, and the latest recommendation with its settings, risk flags and the past launches it is based on.",
    schema: { launch: z.string().min(3).max(60).describe("Launch code such as L-1060") },
  }, async ({ launch }) => describe(await getLaunchDetail(await launchId(launch))));

  add("create_launch", {
    title: "Create a draft launch",
    description:
      "Create a new product launch as a Draft. This only records the product and its quality targets; it does not start any trial and nothing is approved. " +
      "Use get_category_setup first to see the fields, units and allowed values. Required fields must be given. A person reviews the launch in the web app.",
    schema: {
      category: z.string().max(60).describe("Category code, for example UHT_DRINK"),
      line: z.string().max(60).describe("Line code, for example L1"),
      product_name: z.string().min(2).max(120),
      attributes: z.record(z.string(), KEY).describe("Product field values keyed by field code, for example {\"viscosity_cp\": 38, \"fat_pct\": 2.8, \"base\": \"cocoa\"}"),
      quality_targets: z.record(z.string(), z.object({ min: z.number().nullable().optional(), max: z.number().nullable().optional() })).optional().describe("Targets keyed by quality test code, for example {\"viscosity_cp\": {\"min\": 35, \"max\": 41}}"),
      objective: z.string().max(300).optional(),
    },
    write: true, needs: "createLaunch",
  }, async (a) => {
    const cid = await categoryId(a.category);
    const cfg = await loadCategoryConfig(cid);
    const allowed = new Set(cfg.attrDefs.filter((d) => d.aiVisible !== false).map((d) => d.code));
    const bad = Object.keys(a.attributes).filter((k) => !allowed.has(k));
    if (bad.length) throw new HttpError(422, `These fields are not available here: ${bad.join(", ")}. Available fields: ${[...allowed].join(", ")}.`, "validation");
    const known = new Set(cfg.tests.map((t) => t.code));
    const badT = Object.keys(a.quality_targets ?? {}).filter((k) => !known.has(k));
    if (badT.length) throw new HttpError(422, `Unknown quality tests: ${badT.join(", ")}. Known tests: ${[...known].join(", ")}.`, "validation");
    const specs = Object.fromEntries(Object.entries(a.quality_targets ?? {}).map(([k, v]) => [k, { min: v.min ?? null, max: v.max ?? null }]));
    const r = await createLaunch(ctx.userId, { categoryId: cid, lineId: await lineId(a.line), name: a.product_name, objective: a.objective, attrs: a.attributes, specs });
    return { launch: r.code, status: "Draft", review_here: link(r.id), next: "Call recommend with this launch code to get a proposed starting window. A person must review and approve any plan in the web app." };
  });

  add("recommend", {
    title: "Recommend a starting window",
    description:
      "Ask the system for a recommended starting recipe and process window for a launch, based on similar past launches. Returns the settings, confidence, risk flags and the evidence. " +
      "This is a PROPOSAL stored for a person to review: it does not approve anything or start a trial. Tell the user to review and decide at the link returned.",
    schema: { launch: z.string().min(3).max(60).describe("Launch code such as L-1060") },
    write: true, needs: "recommend",
  }, async ({ launch }) => {
    const id = await launchId(launch);
    await createRecommendation(id, ctx.userId);
    return { ...describe(await getLaunchDetail(id)), reminder: "This is a proposal. A person must review and approve it in the web app before any trial uses it." };
  });

  add("explain_recommendation", {
    title: "Explain the latest recommendation",
    description: "Explain in plain language why the latest recommendation for a launch says what it says, citing the past launches behind it. Uses Claude when it is configured, otherwise a standard explanation built from the same numbers.",
    schema: { launch: z.string().min(3).max(60) },
    needs: "useAi",
  }, async ({ launch }) => {
    const id = await launchId(launch);
    const d = await getLaunchDetail(id);
    const rec = d.recommendations[0];
    if (!rec) throw new HttpError(409, "This launch has no recommendation yet. Call recommend first.", "conflict");
    const e: any = await explainRecommendation(id, rec.id, ctx.userId);
    return { launch, summary: e.summary, key_points: e.key_points, watch_outs: e.watch_outs, written_by: e.source, warnings: [...(e.unverified_numbers?.length ? [`Numbers not found in the data: ${e.unverified_numbers.join(", ")}`] : []), ...(e.invalid_citations?.length ? [`Citations not in the evidence: ${e.invalid_citations.join(", ")}`] : [])] };
  });

  add("preview_weights", {
    title: "Preview the effect of weights",
    description: "What-if: show how the recommendation would change if some product fields or parameters mattered more or less (0 = ignore, 5 = critical). Nothing is saved. Changing weights for real is done by a person in the web app.",
    schema: {
      launch: z.string().min(3).max(60),
      attribute_weights: z.record(z.string(), z.number().int().min(0).max(5)).optional().describe("Product field code to weight 0-5"),
      parameter_weights: z.record(z.string(), z.number().int().min(0).max(5)).optional().describe("Parameter code to weight 0-5"),
    },
  }, async (a) => {
    const id = await launchId(a.launch);
    const current = await previewRecommendation(id, undefined);
    const proposed = await previewRecommendation(id, {
      attributes: { ...current.weights.levels.attributes, ...(a.attribute_weights ?? {}) },
      parameters: { ...current.weights.levels.parameters, ...(a.parameter_weights ?? {}) },
    });
    const sum = (r: typeof current) => ({
      similar_launches: r.result.nMatched, confidence: r.result.confidence, overall_risk: r.result.overallRisk,
      nearest: r.result.neighbours.slice(0, 5).map((n) => ({ launch: n.code, similarity: n.similarity })),
      settings: r.result.lines.map((l) => ({ parameter: l.code, start: l.startValue, window: [l.windowLow, l.windowHigh] })), warnings: r.warnings,
    });
    return { launch: a.launch, saved: false, current_weights: sum(current), with_your_weights: sum(proposed) };
  });

  add("ask_history", {
    title: "Ask about past launches",
    description: "Ask a question about past launches in a category, for example which high-viscosity launches needed rework and why. Answered by Claude from the trial records, citing launch codes. Needs the Claude API to be configured.",
    schema: { question: z.string().min(5).max(1000), category: z.string().max(60).describe("Category code, for example UHT_DRINK") },
    needs: "useAi",
  }, async ({ question, category }) => {
    if (!aiEnabled()) throw new AiUnavailable();
    const r = await askHistory(question, await categoryId(category), ctx.userId);
    return { answer: r.answer, launches_cited: r.citedCodes, citations_not_found_in_records: r.invalidCitations };
  });

  add("get_dashboard", {
    title: "Get the dashboard figures",
    description: "Headline figures: first-pass rate, runs per launch, loss per launch and days to acceptance, for past launches and for launches that used a recommendation, plus open launches by status.",
    schema: {},
  }, async () => {
    const k: any = await dashboardKpis();
    const g = (used: boolean) => k.groups.find((x: any) => x.used === used) ?? null;
    return {
      history_before_the_tool: g(false), launches_that_used_a_recommendation: g(true), open_launches_by_status: k.open,
      recommendations: k.usage, caution: "Small samples are not evidence. Treat the comparison as pilot tracking only.",
    };
  });

  /* ---- plant: seals and filler health (read-only) ---- */
  add("get_plant_status", {
    title: "Get the plant status",
    description: "Status of every line across launches, seals and gaskets, and filler health: Attention / Watch / OK with reasons, seals at High risk, the filler station needing attention, next planned stop and open launches. Read-only.",
    schema: {},
  }, async () => {
    const { lines, asOf } = await plantStatus();
    return { as_of: asOf, lines: lines.map((l) => ({ line: l.code, state: l.state, reasons: l.reasons, seals_high: l.seals.high, high_without_planned_stop: l.seals.highWithoutStop, filler_station: l.filler ? { name: l.filler.station, level: l.filler.level, score: l.filler.score, prediction: l.filler.prediction } : null, next_planned_stop: l.nextStop, open_launches: l.launches.map((x) => x.code) })), see: `${ctx.baseUrl}/plant` };
  });

  add("get_seal_risk", {
    title: "Get seal and gasket risk",
    description: "Seals and gaskets ranked by risk score (0-100) with the main factors, the date the seal is projected to reach High, and the recommended planned stop. The score is a rule-based estimate from this plant's own history, not a certainty. Alerts are acknowledged and planned by people in the web app.",
    schema: { line: z.string().max(20).optional().describe("Line code such as L1"), level: z.enum(["High", "Medium", "Low"]).optional(), limit: z.number().int().min(1).max(30).default(10) },
  }, async ({ line, level, limit }) => {
    const r = await riskBoard();
    const rows = r.ranked.filter((x) => (!line || x.lineCode.toLowerCase() === line.toLowerCase()) && (!level || x.result.level === level)).slice(0, limit);
    return { counts: r.counts, engine: r.engineVersion, seals: rows.map((x) => ({ line: x.lineCode, position: `${x.assembly} · ${x.positionName}`, part: x.partCode, score: x.result.score, level: x.result.level, reaches_high_on: x.projectedHighOn, recommended_stop: x.recommendedStop, why: summarise(x, x.projectedDays), url: `${ctx.baseUrl}/assets/positions/${x.positionId}` })), see: `${ctx.baseUrl}/risk` };
  });

  add("get_filler_health", {
    title: "Get filler health",
    description: "Prioritised health of the filler: KPIs against usual, every station ranked by attention score with the evidence, stop prediction (a trend from earlier stops, not a trained model), linked seal and next actions. Read-only: a person changes settings on the machine.",
    schema: { line: z.string().max(20).optional().describe("Line code such as L1. Defaults to the first filler.") },
  }, async ({ line }) => {
    const fillers = await listFillers();
    const f = line ? fillers.find((x: any) => x.line_code.toLowerCase() === line.toLowerCase()) : fillers[0];
    if (!f) throw new HttpError(404, `No filler on line "${line}".`, "not_found");
    const h = await fillerHealth(f.id);
    return {
      filler: `${h.filler.line_code}/${h.filler.code}`, kpis_last_7_days_vs_usual: h.kpis,
      stations: h.stations.slice(0, 6).map((s) => ({ station: s.code, name: s.name, score: s.score, level: s.level, top_alarm: s.topAlarm, stop_prediction: s.prediction.text, seal: s.seal, next_actions: s.actions.map((a) => a.text) })),
      see: `${ctx.baseUrl}/line-health?filler=${f.id}`,
    };
  });

  add("get_launch_line_context", {
    title: "Get the line context for a launch",
    description: "What the launch's line looks like right now: status, seals at High risk, filler station needing attention, planned stops, and plain advice for whoever plans the trial. Information only; it does not change the launch.",
    schema: { launch: z.string().min(3).max(60).describe("Launch code such as L-1060") },
  }, async ({ launch }) => {
    const c = await launchLineContext(await launchId(launch));
    if (!c) throw new HttpError(404, "No line context for this launch.", "not_found");
    return { launch: c.launch, line: c.line.code, state: c.line.state, reasons: c.line.reasons, next_planned_stop: c.line.nextStop, advice: c.advice };
  });

  return server;
}

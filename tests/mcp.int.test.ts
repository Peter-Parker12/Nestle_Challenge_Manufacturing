/**
 * MCP endpoint, tested with the official MCP client over HTTP.
 *   API_BASE=http://localhost:9361 MCP_API_KEY=<key> npx vitest run tests/mcp.int.test.ts
 * Needs the server started with the same MCP_API_KEY and a freshly seeded database.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.API_BASE;
const KEY = process.env.MCP_API_KEY ?? "";
const run = BASE && KEY ? describe : describe.skip;

const connect = async (key = KEY) => {
  const c = new Client({ name: "test-client", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } }));
  return c;
};
const text = (r: any): string => (r.content as any[]).map((x) => x.text).join("\n");
const data = (r: any) => JSON.parse(text(r));
const rpc = (headers: Record<string, string>, path = "/mcp") =>
  fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raw", version: "1" } } }) });

run("MCP endpoint for Copilot", () => {
  let c: Client;
  let owner = "", cat = "";
  const api = async (role: string, method: string, path: string, body?: unknown) => {
    const s = await (await fetch(`${BASE}/api/session`)).json();
    const id = s.users.find((u: any) => u.role === role).id;
    const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie: `baf1_user=${id}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  beforeAll(async () => {
    c = await connect();
    cat = (await api("rd_engineer", "GET", "/api/launches")).body.categories.find((x: any) => x.code === "UHT_DRINK").id;
    owner = "category_owner";
  });
  afterAll(async () => { await c?.close(); });

  it("refuses requests without a valid key", async () => {
    expect((await rpc({})).status).toBe(401);
    expect((await rpc({ authorization: "Bearer wrong-key-wrong-key" })).status).toBe(401);
    const noKey = await rpc({});
    expect(noKey.headers.get("www-authenticate")).toMatch(/Bearer/);
    expect((await rpc({ authorization: `Bearer ${KEY}` })).status).toBe(200);
    expect((await rpc({ "x-api-key": KEY })).status).toBe(200); // the other header Copilot Studio can send
    expect((await rpc({ authorization: `Bearer ${KEY}` }, "/api/mcp")).status).toBe(200); // both addresses work
  });

  it("is stateless and does not stream: GET is refused", async () => {
    const r = await fetch(`${BASE}/mcp`, { headers: { authorization: `Bearer ${KEY}` } });
    expect(r.status).toBe(405);
  });

  it("lists the tools and gives them descriptions Copilot can use", async () => {
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["ask_history", "create_launch", "explain_recommendation", "get_category_setup", "get_dashboard", "get_filler_health", "get_launch", "get_launch_line_context", "get_plant_status", "get_seal_risk", "list_launches", "preview_weights", "recommend"]);
    for (const t of tools) { expect(t.description!.length).toBeGreaterThan(40); expect(t.inputSchema.type).toBe("object"); }
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(by.get_launch.annotations?.readOnlyHint).toBe(true);
    expect(by.create_launch.annotations?.readOnlyHint).toBe(false);
    expect(by.recommend.annotations?.readOnlyHint).toBe(false);
    expect(by.create_launch.annotations?.destructiveHint).toBe(false);
  });

  it("cannot approve, reject, record results or acceptance, or change setup: no such tools exist", async () => {
    const names = (await c.listTools()).tools.map((t) => t.name).join(" ");
    for (const w of ["approve", "decide", "decision", "reject", "result", "review", "accept", "ta", "weights_set", "field", "parameter", "cancel", "import"]) {
      // preview_weights is read-only and the only name containing "weights"; get_plant_status only contains "ta" inside "status"
      const hit = names.split(" ").filter((n) => n.includes(w) && !["preview_weights", "get_plant_status"].includes(n));
      expect(hit, `unexpected tool matching "${w}"`).toEqual([]);
    }
  });

  it("describes a category so Copilot can fill a launch correctly", async () => {
    const list = data(await c.callTool({ name: "get_category_setup", arguments: {} }));
    expect(list.categories.map((x: any) => x.code)).toContain("UHT_DRINK");
    const s = data(await c.callTool({ name: "get_category_setup", arguments: { category: "UHT_DRINK" } }));
    const visc = s.product_fields.find((f: any) => f.code === "viscosity_cp");
    expect(visc).toMatchObject({ type: "numeric", unit: "cP", required: true, allowed_range: [5, 60] });
    expect(s.product_fields.find((f: any) => f.code === "base").options).toContain("cocoa");
    expect(s.quality_tests.map((t: any) => t.code)).toContain("sediment_pct");
    expect(s.lines.length).toBeGreaterThan(0);
    const bad = await c.callTool({ name: "get_category_setup", arguments: { category: "NOPE" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/No category/);
  });

  let code = "", launchUrl = "";
  const good = { category: "UHT_DRINK", line: "L1", product_name: "Copilot test drink", attributes: { viscosity_cp: 38, fat_pct: 2.8, solids_pct: 15.5, base: "cocoa" }, quality_targets: { viscosity_cp: { min: 35, max: 41 }, sediment_pct: { max: 0.5 } } };

  it("returns clear, fixable errors for a bad draft", async () => {
    const r1 = await c.callTool({ name: "create_launch", arguments: { ...good, attributes: { viscosity_cp: 999, fat_pct: 2.8, solids_pct: 15.5, base: "cocoa" } } });
    expect(r1.isError).toBe(true);
    expect(text(r1)).toMatch(/outside the allowed range 5 to 60/);
    const r2 = await c.callTool({ name: "create_launch", arguments: { ...good, attributes: { ...good.attributes, base: "cheese" } } });
    expect(text(r2)).toMatch(/not one of/);
    const r3 = await c.callTool({ name: "create_launch", arguments: { ...good, attributes: { ...good.attributes, bogus: 1 } } });
    expect(text(r3)).toMatch(/not available here: bogus/);
    const r4 = await c.callTool({ name: "create_launch", arguments: { ...good, line: "L99" } });
    expect(text(r4)).toMatch(/No line "L99"/);
    const r5 = await c.callTool({ name: "create_launch", arguments: { ...good, quality_targets: { nope: { min: 1 } } } });
    expect(text(r5)).toMatch(/Unknown quality tests/);
  });

  it("drafts a launch that stays a Draft, with a link for a person", async () => {
    const r = data(await c.callTool({ name: "create_launch", arguments: good }));
    code = r.launch;
    launchUrl = r.review_here;
    expect(code).toMatch(/^L-\d+$/);
    expect(r.status).toBe("Draft");
    expect(launchUrl).toContain("/launches/");
    const list = data(await c.callTool({ name: "list_launches", arguments: { status: "Draft", limit: 50 } }));
    expect(list.launches.some((l: any) => l.launch === code)).toBe(true);
    const g = data(await c.callTool({ name: "get_launch", arguments: { launch: code } }));
    expect(g.product).toBe("Copilot test drink");
    expect(g.latest_recommendation).toBeNull();
    expect(g.quality_targets.find((t: any) => t.test === "sediment_pct")).toMatchObject({ max: 0.5, critical: true });
  });

  it("recommends as a proposal only: nothing is approved and no run is created", async () => {
    const r = data(await c.callTool({ name: "recommend", arguments: { launch: code } }));
    expect(r.status).toBe("Recommended");
    expect(r.latest_recommendation.decision).toBe("waiting for a person to decide");
    expect(r.latest_recommendation.settings.length).toBe(5);
    expect(r.latest_recommendation.settings[0]).toMatchObject({ parameter: expect.any(String), name: expect.any(String), unit: expect.any(String) });
    expect(r.latest_recommendation.evidence.length).toBeGreaterThan(0);
    expect(r.latest_recommendation.risk_flags.length).toBeGreaterThan(0);
    expect(r.reminder).toMatch(/person must review/);
    expect(r.runs).toEqual([]); // no run exists until a human approves
    const id = launchUrl.split("/launches/")[1];
    const web = (await api("rd_engineer", "GET", `/api/launches/${id}`)).body;
    expect(web.recommendations[0].decision).toBeNull();
    expect(web.launch.status).toBe("Recommended");
  });

  it("previews weights without saving", async () => {
    const id = launchUrl.split("/launches/")[1];
    const before = (await api("rd_engineer", "GET", `/api/launches/${id}`)).body.recommendations.length;
    const p = data(await c.callTool({ name: "preview_weights", arguments: { launch: code, attribute_weights: { fat_pct: 5, viscosity_cp: 0 } } }));
    expect(p.saved).toBe(false);
    expect(p.current_weights.nearest.length).toBeGreaterThan(0);
    expect(p.with_your_weights.nearest.length).toBeGreaterThan(0);
    expect((await api("rd_engineer", "GET", `/api/launches/${id}`)).body.recommendations.length).toBe(before);
    expect((await c.callTool({ name: "preview_weights", arguments: { launch: code, attribute_weights: { fat_pct: 9 } } })).isError).toBe(true); // outside 0-5 is rejected by the schema
  });

  it("explains the recommendation, and says when there is none", async () => {
    const e = data(await c.callTool({ name: "explain_recommendation", arguments: { launch: code } }));
    expect(e.summary.length).toBeGreaterThan(20);
    expect(["claude", "template"]).toContain(e.written_by);
    const draft = data(await c.callTool({ name: "create_launch", arguments: { ...good, product_name: "No rec yet" } }));
    const none = await c.callTool({ name: "explain_recommendation", arguments: { launch: draft.launch } });
    expect(none.isError).toBe(true);
    expect(text(none)).toMatch(/no recommendation yet/);
  });

  it("answers history questions only when Claude is configured", async () => {
    const health = await (await fetch(`${BASE}/api/health`)).json();
    const r = await c.callTool({ name: "ask_history", arguments: { question: "Which launches needed rework?", category: "UHT_DRINK" } });
    if (!health.ai) { expect(r.isError).toBe(true); expect(text(r)).toMatch(/needs the Claude API/); }
    else expect(r.isError).toBeFalsy();
  });

  it("reports dashboard figures", async () => {
    const d = data(await c.callTool({ name: "get_dashboard", arguments: {} }));
    expect(d.history_before_the_tool.launches).toBeGreaterThan(0);
    expect(d.caution).toMatch(/Small samples/);
  });

  it("keeps fields marked 'never shared with AI' out of everything, and refuses to write them", async () => {
    const mk = await api(owner, "POST", `/api/categories/${cat}/fields`, { code: "private_note", name: "Private note", type: "text" }); // text defaults to not AI visible
    await api(owner, "PATCH", `/api/categories/${cat}/fields/${mk.body.id}`, { action: "activate" });
    const web = await api("rd_engineer", "POST", "/api/launches", { categoryId: cat, lineId: (await api("rd_engineer", "GET", "/api/launches")).body.lines[0].id, name: "Has a private note", attrs: { viscosity_cp: 30, fat_pct: 2, solids_pct: 12, base: "milk", private_note: "TOP-SECRET-VALUE" }, specs: {} });
    expect(web.status).toBe(200);
    const setup = text(await c.callTool({ name: "get_category_setup", arguments: { category: "UHT_DRINK" } }));
    expect(setup).not.toContain("private_note");
    expect(setup).not.toContain("Private note");
    const launch = (await api("rd_engineer", "GET", `/api/launches/${web.body.id}`)).body.launch.code;
    const got = text(await c.callTool({ name: "get_launch", arguments: { launch } }));
    expect(got).not.toContain("TOP-SECRET-VALUE");
    expect(got).not.toContain("private_note");
    const w = await c.callTool({ name: "create_launch", arguments: { ...good, attributes: { ...good.attributes, private_note: "x" } } });
    expect(w.isError).toBe(true);
    expect(text(w)).toMatch(/not available here: private_note/);
    await api(owner, "PATCH", `/api/categories/${cat}/fields/${mk.body.id}`, { action: "retire", reason: "test cleanup" });
  });

  it("acts as a service account that is not a person: audited, and absent from the user list", async () => {
    const s = await (await fetch(`${BASE}/api/session`)).json();
    expect(s.users.some((u: any) => /Copilot/.test(u.name))).toBe(false);
    const audit = (await api("qa", "GET", "/api/audit?limit=500")).body.events;
    const calls = audit.filter((e: any) => e.action === "MCP_TOOL");
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.every((e: any) => e.user_name === "Copilot (MCP)")).toBe(true);
    expect(audit.some((e: any) => e.entity === "core.launch_project" && e.user_name === "Copilot (MCP)")).toBe(true); // the draft it created
  });

  it("plant tools are read-only, answer from the same data as the web app, and write nothing", async () => {
    const by = Object.fromEntries((await c.listTools()).tools.map((t) => [t.name, t]));
    for (const n of ["get_plant_status", "get_seal_risk", "get_filler_health", "get_launch_line_context"]) expect(by[n].annotations?.readOnlyHint, n).toBe(true);
    const plant = data(await c.callTool({ name: "get_plant_status", arguments: {} }));
    expect(plant.lines.find((l: any) => l.line === "L1").state).toBe("Attention");
    const seals = data(await c.callTool({ name: "get_seal_risk", arguments: { line: "L1", level: "High", limit: 3 } }));
    expect(seals.seals.length).toBeGreaterThan(0);
    expect(seals.seals.every((s: any) => s.level === "High" && s.line === "L1")).toBe(true);
    expect(seals.seals[0].why).toMatch(/Score/);
    const fh = data(await c.callTool({ name: "get_filler_health", arguments: { line: "L1" } }));
    expect(fh.stations[0].station).toBe("V3");
    expect((await c.callTool({ name: "get_filler_health", arguments: { line: "L99" } })).isError).toBe(true);
    const ctx = data(await c.callTool({ name: "get_launch_line_context", arguments: { launch: code } }));
    expect(ctx.line).toBeTruthy();
    expect(Array.isArray(ctx.advice)).toBe(true);
  });

  it("rejects unknown launches with a helpful message", async () => {
    const r = await c.callTool({ name: "get_launch", arguments: { launch: "L-99999" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/list_launches/);
  });
});

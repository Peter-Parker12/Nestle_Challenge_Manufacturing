/**
 * End-to-end scenario against a running server and database.
 *   API_BASE=http://localhost:9361 npx vitest run tests/e2e.int.test.ts
 * It writes to the database. Reseed afterwards: npm run db:seed -- --force
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.API_BASE;
const run = BASE ? describe : describe.skip;

type R = { status: number; body: any };
let users: Record<string, string> = {};
const call = async (role: string | null, method: string, path: string, data?: unknown): Promise<R> => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(role ? { cookie: `baf1_user=${users[role]}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

run("BAF-1 end to end", () => {
  let launchId = "";
  let categoryId = "";
  let detail: any;

  beforeAll(async () => {
    const s = await call(null, "GET", "/api/session");
    for (const u of s.body.users) users[u.role] = u.id;
    const l = await call("rd_engineer", "GET", "/api/launches");
    categoryId = l.body.categories.find((c: any) => c.code === "UHT_DRINK").id;
    const demo = l.body.launches.find((x: any) => x.product.includes("(demo)") && x.status === "Draft");
    launchId = demo.id;
  });

  it("is healthy", async () => {
    const h = await call(null, "GET", "/api/health");
    expect(h.status).toBe(200);
    expect(h.body.db).toBe(true);
  });

  it("blocks roles that may not act (403)", async () => {
    expect((await call("viewer", "POST", `/api/launches/${launchId}/recommend`)).status).toBe(403);
    expect((await call("qa", "POST", `/api/launches/${launchId}/recommend`)).status).toBe(403);
    expect((await call("viewer", "GET", "/api/audit")).status).toBe(403);
  });

  it("validates new launches (422)", async () => {
    const lines = (await call("rd_engineer", "GET", "/api/launches")).body.lines;
    const bad = await call("rd_engineer", "POST", "/api/launches", {
      categoryId, lineId: lines[0].id, name: "Bad", attrs: { viscosity_cp: 9999, fat_pct: 2, solids_pct: 12, base: "milk" },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.message).toMatch(/Target viscosity/);
  });

  it("creates a recommendation with evidence, windows and flags", async () => {
    const r = await call("rd_engineer", "POST", `/api/launches/${launchId}/recommend`);
    expect(r.status).toBe(200);
    detail = (await call("rd_engineer", "GET", `/api/launches/${launchId}`)).body;
    const rec = detail.recommendations[0];
    expect(rec.lines).toHaveLength(5);
    expect(rec.evidence.length).toBeGreaterThanOrEqual(3);
    expect(rec.flags.length).toBeGreaterThan(0);
    expect(rec.lines.every((l: any) => l.windowLow <= l.startValue && l.startValue <= l.windowHigh)).toBe(true);
    expect(detail.launch.status).toBe("Recommended");
  });

  it("compares default weights with the engineer's weights without saving (BR-11)", async () => {
    const before = (await call("rd_engineer", "GET", `/api/launches/${launchId}`)).body.recommendations.length;
    const c = await call("rd_engineer", "POST", `/api/launches/${launchId}/compare`, { attributes: { fat_pct: 5, viscosity_cp: 0 } });
    expect(c.status).toBe(200);
    expect(c.body.current.neighbours).toBeTruthy();
    expect(c.body.proposed.neighbours).toBeTruthy();
    expect((await call("rd_engineer", "GET", `/api/launches/${launchId}`)).body.recommendations.length).toBe(before);
  });

  it("requires a reason to change weights (BR-07)", async () => {
    expect((await call("rd_engineer", "POST", `/api/launches/${launchId}/weights`, { attributes: { fat_pct: 5 }, reason: "" })).status).toBe(422);
    expect((await call("rd_engineer", "POST", `/api/launches/${launchId}/weights`, { attributes: { fat_pct: 5 }, parameters: {}, reason: "Fat drives creaming on this recipe" })).status).toBe(200);
    expect((await call("category_owner", "POST", `/api/launches/${launchId}/weights`, { attributes: {}, reason: "x" })).status).toBe(403);
  });

  it("rejects values outside line capability when editing a plan (BR-02)", async () => {
    const rec = detail.recommendations[0];
    const r = await call("rd_engineer", "POST", `/api/launches/${launchId}/recommendations/${rec.id}/decision`, {
      action: "edited", finalValues: { uht_temp_c: 150 }, reason: "test",
    });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/outside line capability/);
  });

  let run1 = "";
  it("approves the plan and creates run 1", async () => {
    const rec = detail.recommendations[0];
    const r = await call("rd_engineer", "POST", `/api/launches/${launchId}/recommendations/${rec.id}/decision`, { action: "approved", reason: rec.confidence === "Low" ? "Accepted after engineer review" : undefined });
    expect(r.status).toBe(200);
    run1 = r.body.runId;
    expect(run1).toBeTruthy();
    const again = await call("rd_engineer", "POST", `/api/launches/${launchId}/recommendations/${rec.id}/decision`, { action: "approved", reason: "dup" });
    expect(again.status).toBe(409);
  });

  it("only a process engineer starts a run", async () => {
    expect((await call("rd_engineer", "POST", `/api/runs/${run1}/start`)).status).toBe(403);
    expect((await call("process_engineer", "POST", `/api/runs/${run1}/start`)).status).toBe(200);
  });

  it("derives a Fail from out-of-spec critical results (BR-13)", async () => {
    const r = await call("process_engineer", "POST", `/api/runs/${run1}/results`, {
      actuals: { homog_pressure_bar: 200, uht_temp_c: 140, hold_time_s: 4.5, fill_temp_c: 22, flow_rate_lph: 4600 },
      quality: { viscosity_cp: 30, sediment_pct: 0.72, creaming_idx: 1.2, ph: 6.7 }, lossKg: 240,
    });
    expect(r.status).toBe(200);
    expect(r.body.result).toBe("Fail");
    expect((await call("process_engineer", "POST", `/api/runs/${run1}/results`, { actuals: {}, quality: { viscosity_cp: 1 } })).status).toBe(409);
  });

  it("needs a reason code before the run can be closed and before the next run (BR-14)", async () => {
    const noReason = await call("process_engineer", "POST", `/api/runs/${run1}/review`, { reasons: [], nextStep: "Repeat" });
    expect(noReason.status).toBe(422);
    const noTA = await call("process_engineer", "POST", `/api/runs/${run1}/review`, { reasons: ["sedimentation"], nextStep: "TA" });
    expect(noTA.status).toBe(422);
    const ok = await call("process_engineer", "POST", `/api/runs/${run1}/review`, { reasons: ["sedimentation"], nextStep: "Repeat" });
    expect(ok.status).toBe(200);
  });

  let run2 = "";
  it("plans run 2 from a fresh recommendation", async () => {
    expect((await call("rd_engineer", "POST", `/api/launches/${launchId}/recommend`)).status).toBe(200);
    detail = (await call("rd_engineer", "GET", `/api/launches/${launchId}`)).body;
    const rec = detail.recommendations[0];
    expect(rec.runNoTarget).toBe(2);
    const r = await call("rd_engineer", "POST", `/api/launches/${launchId}/recommendations/${rec.id}/decision`, { action: "approved", reason: "Reviewed; accept the window" });
    expect(r.status).toBe(200);
    run2 = r.body.runId;
  });

  it("passes run 2, requires a reason to override, and needs QA for acceptance", async () => {
    await call("process_engineer", "POST", `/api/runs/${run2}/start`);
    const res = await call("process_engineer", "POST", `/api/runs/${run2}/results`, {
      actuals: { homog_pressure_bar: 245, uht_temp_c: 141, hold_time_s: 4.8, fill_temp_c: 22, flow_rate_lph: 4630 },
      quality: { viscosity_cp: 38.2, sediment_pct: 0.28, creaming_idx: 1.1, ph: 6.7 }, lossKg: 60,
    });
    expect(res.body.result).toBe("Pass");
    expect((await call("process_engineer", "POST", `/api/runs/${run2}/review`, { reasons: [], nextStep: "TA", overrideResult: "Marginal" })).status).toBe(422);
    expect((await call("process_engineer", "POST", `/api/runs/${run2}/review`, { reasons: [], nextStep: "TA" })).status).toBe(200);
    expect((await call("process_engineer", "POST", `/api/launches/${launchId}/ta`, { decision: "Accepted" })).status).toBe(403);
    expect((await call("qa", "POST", `/api/launches/${launchId}/ta`, { decision: "Accepted" })).status).toBe(200);
  });

  it("makes a closed launch read-only (BR-15)", async () => {
    expect((await call("rd_engineer", "POST", `/api/launches/${launchId}/cancel`, { reason: "late" })).status).toBe(409);
    expect((await call("rd_engineer", "POST", `/api/launches/${launchId}/recommend`)).status).toBe(409);
    const d = (await call("rd_engineer", "GET", `/api/launches/${launchId}`)).body;
    expect(d.launch.status).toBe("Closed");
    expect(d.runs.map((r: any) => r.runNo)).toEqual([1, 2]);
  });

  it("records every step in the audit log", async () => {
    const a = await call("qa", "GET", "/api/audit?limit=200");
    expect(a.status).toBe(200);
    const entities = new Set(a.body.events.map((e: any) => e.entity));
    for (const e of ["core.launch_project", "core.trial_run", "rec.recommendation", "rec.decision", "rec.weight_set"]) expect(entities.has(e)).toBe(true);
  });

  it("reports KPIs that separate launches that used a recommendation", async () => {
    const k = await call(null, "GET", "/api/kpis");
    expect(k.status).toBe(200);
    expect(k.body.groups.some((g: any) => g.used === true)).toBe(true);
  });

  it("degrades cleanly without an API key", async () => {
    const st = await call(null, "GET", "/api/ai/status");
    if (st.body.enabled) return; // only meaningful when no key is configured
    expect((await call("rd_engineer", "POST", "/api/ai/ask", { question: "why?", categoryId })).status).toBe(503);
    const rec = detail.recommendations[0];
    const ex = await call("rd_engineer", "POST", `/api/launches/${launchId}/recommendations/${rec.id}/explain`, {});
    expect(ex.status).toBe(200);
    expect(ex.body.source).toBe("template");
  });

  it("only the category owner changes category defaults (BR-07)", async () => {
    expect((await call("rd_engineer", "POST", `/api/categories/${categoryId}/weights`, { attributes: { fat_pct: 2 }, reason: "x" })).status).toBe(403);
    expect((await call("category_owner", "POST", `/api/categories/${categoryId}/weights`, { attributes: { fat_pct: 4 }, parameters: {}, reason: "Review after Q3" })).status).toBe(200);
  });

  it("a category with no history gives Low confidence, and approval then needs a reason (BR-04); categories need no code change", async () => {
    const meta = (await call("rd_engineer", "GET", "/api/launches")).body;
    const sauce = meta.categories.find((c: any) => c.code === "SAUCE");
    const created = await call("rd_engineer", "POST", "/api/launches", {
      categoryId: sauce.id, lineId: meta.lines[0].id, name: "Test chilli sauce", attrs: { salt_pct: 12, ph: 4.2 }, specs: {},
    });
    expect(created.status).toBe(200);
    const id = created.body.id;
    const r = await call("rd_engineer", "POST", `/api/launches/${id}/recommend`);
    expect(r.body.confidence).toBe("Low");
    expect(r.body.nMatched).toBe(0);
    const d = (await call("rd_engineer", "GET", `/api/launches/${id}`)).body;
    const recId = d.recommendations[0].id;
    const noReason = await call("rd_engineer", "POST", `/api/launches/${id}/recommendations/${recId}/decision`, { action: "approved" });
    expect(noReason.status).toBe(422);
    expect(noReason.body.message).toMatch(/BR-04/);
    const withReason = await call("rd_engineer", "POST", `/api/launches/${id}/recommendations/${recId}/decision`, { action: "approved", reason: "No history; engineer will start from the supplier datasheet" });
    expect(withReason.status).toBe(200);
  });

  it("imports historical launches from a CSV: template, check, errors, commit, duplicates, roles", async () => {
    const meta = (await call("rd_engineer", "GET", "/api/launches")).body;
    const cat = meta.categories.find((c: any) => c.code === "UHT_DRINK").id;
    const tpl = await (await fetch(`${BASE}/api/import/template?categoryId=${cat}`)).text();
    expect(tpl.split("\r\n")[0]).toContain("param_homog_pressure_bar");
    const ref = `E2E-${Date.now()}`;
    const good = tpl.replaceAll("EX-1", ref).replace("Example product (replace)", "Imported by test");
    const send = async (role: string, csv: string) => {
      const f = new FormData();
      f.append("file", new Blob([csv], { type: "text/csv" }), "t.csv"); f.append("categoryId", cat); f.append("assumeAccepted", "false");
      const r = await fetch(`${BASE}/api/import/validate`, { method: "POST", headers: { cookie: `baf1_user=${users[role]}` }, body: f });
      return { status: r.status, body: await r.json() };
    };
    expect((await send("rd_engineer", good)).status).toBe(403);
    const bad = await send("plant_admin", good.replace(",L1,", ",L99,"));
    expect(bad.body.errors.some((e: any) => /Unknown line/.test(e.message))).toBe(true);
    expect((await call("plant_admin", "POST", `/api/import/${bad.body.loadId}/commit`, {})).status).toBe(409);
    const ok = await send("plant_admin", good);
    expect(ok.status).toBe(200);
    expect(ok.body.errors).toEqual([]);
    expect(ok.body.runs).toBe(2);
    const c = await call("plant_admin", "POST", `/api/import/${ok.body.loadId}/commit`, {});
    expect(c.status).toBe(200);
    expect(c.body.imported).toBe(1);
    expect((await call("plant_admin", "POST", `/api/import/${ok.body.loadId}/commit`, {})).status).toBe(409);
    const dup = await send("plant_admin", good);
    expect(dup.body.errors.some((e: any) => /already exists/.test(e.message))).toBe(true);
    const list = (await call("rd_engineer", "GET", "/api/launches")).body.launches.find((l: any) => l.product === "Imported by test");
    expect(list.status).toBe("Closed");
    expect(list.runs).toBe(2);
  });
});

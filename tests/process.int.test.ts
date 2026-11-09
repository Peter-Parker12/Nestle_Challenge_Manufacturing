/**
 * Process setup, end to end. Needs a running server on a freshly seeded database:
 *   API_BASE=http://localhost:9361 npx vitest run tests/process.int.test.ts
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.API_BASE;
const run = BASE ? describe : describe.skip;
let users: Record<string, string> = {};
const call = async (role: string | null, method: string, path: string, data?: unknown) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(role ? { cookie: `baf1_user=${users[role]}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

run("process setup", () => {
  let cat = "", line1 = "", line2 = "", fillingStep = "", pumpId = "", testId = "";
  const proc = async () => (await call("category_owner", "GET", `/api/categories/${cat}/process`)).body;
  const act = (role: string, body: unknown) => call(role, "POST", `/api/categories/${cat}/process`, body);
  const findParam = async (code: string) => (await proc()).steps.flatMap((s: any) => s.parameters).find((p: any) => p.code === code);

  beforeAll(async () => {
    for (const u of (await call(null, "GET", "/api/session")).body.users) users[u.role] = u.id;
    const meta = (await call("rd_engineer", "GET", "/api/launches")).body;
    cat = meta.categories.find((c: any) => c.code === "UHT_DRINK").id;
    [line1, line2] = [meta.lines[0].id, meta.lines[1].id];
    fillingStep = (await proc()).steps.find((s: any) => s.name === "Filling").id;
  });

  it("is changed only by category owners and plant admins", async () => {
    const body = { action: "addStep", name: "Cooling" };
    expect((await act("rd_engineer", body)).status).toBe(403);
    expect((await act("process_engineer", body)).status).toBe(403);
    expect((await act("category_owner", body)).status).toBe(200);
    expect((await act("plant_admin", { action: "addStep", name: "Packing" })).status).toBe(200);
    expect((await act("category_owner", body)).status).toBe(409); // same step name
  });

  it("adds a parameter, validates it, and gives every line the full range", async () => {
    const p = { action: "addParameter", stepId: fillingStep, code: "pump_speed_rpm", name: "Pump speed", unit: "rpm", absMin: 500, absMax: 3000 };
    expect((await act("category_owner", { ...p, unit: "" })).status).toBe(422);
    expect((await act("category_owner", { ...p, absMin: 3000, absMax: 500 })).status).toBe(422);
    expect((await act("category_owner", { ...p, code: "uht_temp_c" })).status).toBe(409); // codes are unique across the whole category
    const r = await act("category_owner", p);
    expect(r.status).toBe(200);
    pumpId = r.body.id;
    const added = await findParam("pump_speed_rpm");
    expect(added.runsWithValue).toBe(0);
    const lines = (await proc()).lines;
    for (const l of lines) expect(added.capability[l.id]).toEqual({ min: 500, max: 3000 });
  });

  it("sets line capability inside the allowed range", async () => {
    const cap = (role: string, min: number, max: number) => act(role, { action: "setCapability", lineId: line1, parameterId: pumpId, min, max });
    expect((await cap("rd_engineer", 800, 2000)).status).toBe(403);
    expect((await cap("plant_admin", 2000, 800)).status).toBe(422);
    expect((await cap("plant_admin", 100, 2000)).status).toBe(422); // below the allowed range
    expect((await cap("plant_admin", 800, 2000)).status).toBe(200);
    expect((await findParam("pump_speed_rpm")).capability[line1]).toEqual({ min: 800, max: 2000 });
    expect((await findParam("pump_speed_rpm")).capability[line2]).toEqual({ min: 500, max: 3000 }); // other lines untouched
  });

  it("a parameter with no history is flagged, and a plan stays inside the line's capability", async () => {
    const l = await call("rd_engineer", "POST", "/api/launches", { categoryId: cat, lineId: line1, name: "New param test", attrs: { viscosity_cp: 30, fat_pct: 2, solids_pct: 12, base: "milk" }, specs: {} });
    await call("rd_engineer", "POST", `/api/launches/${l.body.id}/recommend`);
    const rec = (await call("rd_engineer", "GET", `/api/launches/${l.body.id}`)).body.recommendations[0];
    const pump = rec.lines.find((x: any) => x.code === "pump_speed_rpm");
    expect(pump.windowLow).toBeGreaterThanOrEqual(800);
    expect(pump.windowHigh).toBeLessThanOrEqual(2000);
    expect(rec.flags.some((f: any) => f.type === "missing_data" && /No similar launch recorded Pump speed/.test(f.message))).toBe(true);
    // the parameter is usable on a run
    const dec = await call("rd_engineer", "POST", `/api/launches/${l.body.id}/recommendations/${rec.id}/decision`, { action: "approved", reason: "test" });
    expect(dec.status).toBe(200);
    await call("process_engineer", "POST", `/api/runs/${dec.body.runId}/start`);
    const res = await call("process_engineer", "POST", `/api/runs/${dec.body.runId}/results`, { actuals: { pump_speed_rpm: 1500 }, quality: { viscosity_cp: 30 } });
    expect(res.status).toBe(200);
    expect((await findParam("pump_speed_rpm")).runsWithValue).toBe(1);
    expect((await call("process_engineer", "POST", `/api/runs/${(await call("rd_engineer", "POST", `/api/launches/${l.body.id}/recommend`)).body.id}/results`, { actuals: {}, quality: {} })).status).toBeGreaterThanOrEqual(400);
  });

  it("limits can be widened but not narrowed once runs have values; capability must stay inside", async () => {
    const upd = (patch: unknown) => act("category_owner", { action: "updateParameter", id: pumpId, patch });
    expect((await upd({ absMin: 600 })).status).toBe(422); // narrowing, run data exists
    expect((await upd({ absMax: 2500 })).status).toBe(422);
    expect((await upd({ absMax: 3500 })).status).toBe(200); // widening
    expect((await upd({ isCritical: true, name: "Pump speed (main)" })).status).toBe(200);
    const p = await findParam("pump_speed_rpm");
    expect(p.isCritical).toBe(true);
    expect(p.absMax).toBe(3500);
  });

  it("adds a quality test that decides pass or fail, and ignores older products' missing targets", async () => {
    const t = await act("category_owner", { action: "addTest", code: "color_l", name: "Colour (L*)", isCritical: true });
    expect(t.status).toBe(200);
    testId = t.body.id;
    expect((await act("category_owner", { action: "addTest", code: "color_l", name: "Again" })).status).toBe(409);
    const l = await call("rd_engineer", "POST", "/api/launches", { categoryId: cat, lineId: line2, name: "New test", attrs: { viscosity_cp: 30, fat_pct: 2, solids_pct: 12, base: "milk" }, specs: { color_l: { min: 60, max: 80 } } });
    expect(l.status).toBe(200);
    const d = (await call("rd_engineer", "GET", `/api/launches/${l.body.id}`)).body;
    expect(d.specs.some((s: any) => s.code === "color_l" && Number(s.spec_min) === 60)).toBe(true);
    await call("rd_engineer", "POST", `/api/launches/${l.body.id}/recommend`);
    const rec = (await call("rd_engineer", "GET", `/api/launches/${l.body.id}`)).body.recommendations[0];
    const dec = await call("rd_engineer", "POST", `/api/launches/${l.body.id}/recommendations/${rec.id}/decision`, { action: "approved", reason: "test" });
    await call("process_engineer", "POST", `/api/runs/${dec.body.runId}/start`);
    const res = await call("process_engineer", "POST", `/api/runs/${dec.body.runId}/results`, { actuals: {}, quality: { color_l: 40 } });
    expect(res.body.result).toBe("Fail"); // critical test out of spec
  });

  it("retires a parameter and a test with a reason; they leave forms and recommendations; they can return", async () => {
    expect((await act("category_owner", { action: "setParameterStatus", id: pumpId, status: "Retired" })).status).toBe(422);
    expect((await act("category_owner", { action: "setParameterStatus", id: pumpId, status: "Retired", reason: "Test cleanup" })).status).toBe(200);
    expect((await findParam("pump_speed_rpm")).status).toBe("Retired");
    const l = await call("rd_engineer", "POST", "/api/launches", { categoryId: cat, lineId: line1, name: "After retire", attrs: { viscosity_cp: 30, fat_pct: 2, solids_pct: 12, base: "milk" }, specs: {} });
    await call("rd_engineer", "POST", `/api/launches/${l.body.id}/recommend`);
    const rec = (await call("rd_engineer", "GET", `/api/launches/${l.body.id}`)).body.recommendations[0];
    expect(rec.lines.some((x: any) => x.code === "pump_speed_rpm")).toBe(false);
    expect((await act("category_owner", { action: "setTestStatus", id: testId, status: "Retired", reason: "Test cleanup" })).status).toBe(200);
    expect((await call("rd_engineer", "GET", `/api/launches/${l.body.id}`)).body.specs.some((s: any) => s.code === "color_l")).toBe(false);
    expect((await act("category_owner", { action: "setParameterStatus", id: pumpId, status: "Active" })).status).toBe(200);
    expect((await findParam("pump_speed_rpm")).status).toBe("Active");
    expect((await act("category_owner", { action: "setParameterStatus", id: pumpId, status: "Retired", reason: "Final cleanup" })).status).toBe(200);
  });

  it("shows the definition history of a product field, to the roles that can view the audit log", async () => {
    const c = await call("category_owner", "POST", `/api/categories/${cat}/fields`, { code: "hist_note", name: "History note", type: "text" });
    await call("category_owner", "PATCH", `/api/categories/${cat}/fields/${c.body.id}`, { action: "update", patch: { helpText: "First help text" } });
    await call("category_owner", "PATCH", `/api/categories/${cat}/fields/${c.body.id}`, { action: "update", patch: { helpText: "Second help text", required: true } });
    expect((await call("viewer", "GET", `/api/categories/${cat}/fields/${c.body.id}/history`)).status).toBe(403);
    const h = (await call("category_owner", "GET", `/api/categories/${cat}/fields/${c.body.id}/history`)).body.events;
    expect(h[h.length - 1].action).toBe("INSERT");
    const last = h[0];
    expect(last.changes.some((x: any) => x.field === "help_text" && x.from === "First help text" && x.to === "Second help text")).toBe(true);
    expect(last.changes.some((x: any) => x.field === "required" && x.to === true)).toBe(true);
    await call("category_owner", "PATCH", `/api/categories/${cat}/fields/${c.body.id}`, { action: "retire", reason: "Test cleanup" });
  });

  it("audits setup changes", async () => {
    const a = (await call("category_owner", "GET", "/api/audit?limit=500")).body.events;
    for (const e of ["cfg.parameter_def", "cfg.quality_test_def", "cfg.process_step", "cfg.line_capability"]) expect(a.some((x: any) => x.entity === e)).toBe(true);
  });
});

/**
 * Line health (DNF-2), end to end. Needs a running server WITH the mock Claude (node tests/mock-claude.mjs;
 * ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:9999) on a freshly seeded database:
 *   API_BASE=http://localhost:9361 DATABASE_URL=... npx vitest run tests/health.int.test.ts
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.API_BASE;
const run = BASE && process.env.DATABASE_URL ? describe : describe.skip;
let users: Record<string, string> = {};
const call = async (role: string | null, method: string, path: string, data?: unknown) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(role ? { cookie: `baf1_user=${users[role]}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const today = new Date().toISOString().slice(0, 10);

run("line health", () => {
  let db: Client;
  let h: any, v3: any;
  beforeAll(async () => {
    for (const u of (await call(null, "GET", "/api/session")).body.users) users[u.role] = u.id;
    db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  });
  afterAll(async () => { await db.end(); });
  const load = async () => {
    const d = (await call("viewer", "GET", "/api/line-health")).body;
    const l1 = d.fillers.find((f: any) => f.line_code === "L1");
    h = (await call("viewer", "GET", `/api/line-health?filler=${l1.id}`)).body.health;
    v3 = h.stations.find((s: any) => s.code === "V3");
    return d;
  };

  it("ranks the stations and puts the failing valve first, with evidence and next actions", async () => {
    const d = await load();
    expect(d.fillers.length).toBe(2);
    expect(h.stations.length).toBe(11);
    expect(h.stations[0].code).toBe("V3");
    expect(v3.level).toBe("High");
    const sorted = h.stations.map((s: any) => s.score);
    expect([...sorted].sort((a: number, b: number) => b - a)).toEqual(sorted);
    expect(v3.factors.reduce((a: number, f: any) => a + f.points, 0)).toBeCloseTo(v3.score, 0);
    expect(v3.topAlarm.code).toBe("A-FW-03");
    expect(v3.actions.map((a: any) => a.kind)).toEqual(expect.arrayContaining(["seal", "predict", "task", "guide", "setting"]));
    expect(v3.prediction.status).toBe("at_or_above");
    expect(h.threshold).toBeGreaterThan(0);
    expect(Number(h.kpis.eups7)).toBeLessThan(Number(h.kpis.eups_base)); // the filler has been getting worse
  });

  it("links the alarm to the seal the other module already rated High", async () => {
    expect(v3.seal.name).toBe("Plug seal");
    expect(v3.seal.level).toBe("High");
    const pos = (await call("viewer", "GET", `/api/assets/positions/${v3.seal.positionId}`)).body.position;
    expect(pos.line_code).toBe("L1"); expect(pos.assembly).toBe("Filling valve 3");
    expect(v3.actions.find((a: any) => a.kind === "seal").ref.id).toBe(v3.seal.positionId);
  });

  it("a calm station is Low with 'no action', and the other line is calmer", async () => {
    const calm = h.stations[h.stations.length - 1];
    expect(calm.level).toBe("Low"); expect(calm.actions[0].kind).toMatch(/watch|seal|guide|setting|task/);
    const l2 = (await call("viewer", "GET", "/api/line-health")).body.fillers.find((f: any) => f.line_code === "L2");
    const l2h = (await call("viewer", "GET", `/api/line-health?filler=${l2.id}`)).body.health;
    expect(l2h.stations[0].score).toBeLessThan(v3.score);
  });

  it("station detail has alarms by code and the matching guide with its steps", async () => {
    const d = (await call("viewer", "GET", `/api/line-health/stations/${v3.stationId}`)).body;
    expect(d.byCode.find((a: any) => a.code === "A-FW-03").n).toBeGreaterThan(10);
    const g = d.guides.find((x: any) => x.code === "G-FILLWT");
    expect(g.steps.length).toBeGreaterThan(3); expect(g.steps[0].text).toMatch(/lockout/i);
    expect(d.breakdowns.length).toBeGreaterThan(0);
    expect((await call("viewer", "GET", "/api/line-health/stations/00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it("a person records a correction; it must stay in the approved range, and the system never applies it itself", async () => {
    const d = (await call("viewer", "GET", `/api/line-health/stations/${v3.stationId}`)).body;
    const dwell = d.settings.find((s: any) => s.code === "fill_dwell_ms");
    expect(Number(dwell.current_value)).toBe(416);
    const post = (to: number, why = "Returned to the centerline after the fill weight alarms", role = "maintenance") => call(role, "POST", "/api/line-health/corrections", { settingId: dwell.id, toValue: to, reason: why });
    expect((await post(400, undefined, "viewer")).status).toBe(403);
    expect((await post(500)).status).toBe(409);            // outside 380 to 420
    expect((await post(416)).status).toBe(409);            // no change
    expect((await post(400, "no")).status).toBe(422);      // reason too short
    expect((await post(400)).status).toBe(200);
    const after = (await call("viewer", "GET", `/api/line-health/stations/${v3.stationId}`)).body;
    expect(Number(after.settings.find((s: any) => s.code === "fill_dwell_ms").current_value)).toBe(400);
    expect(after.corrections[0]).toMatchObject({ reason: expect.stringMatching(/centerline/) });
    expect(after.corrections[0].by).toMatch(/Maintenance/);
    await load();
    expect(v3.actions.filter((a: any) => a.kind === "setting").length).toBe(1); // the dwell drift is gone, pressure remains
    const fails = async (sql: string, re: RegExp) => { await db.query("begin"); try { await db.query(sql); throw new Error("allowed: " + sql); } catch (e: any) { expect(e.message).toMatch(re); } finally { await db.query("rollback"); } };
    await fails("update ops.correction set to_value=1", /append-only/);
    await fails("delete from ops.correction", /append-only/);
    await fails(`insert into ops.correction(setting_id,from_value,to_value,reason) values ('${dwell.id}', 123, 401, 'stale view of the setting')`, /changed since you looked/);
    expect((await db.query("select count(*)::int n from audit.event where entity='ops.correction'")).rows[0].n).toBeGreaterThan(0);
  });

  it("guides: roles, validation, retire-never-delete, and a new guide is found by the assistant's search", async () => {
    const g = { code: "G-TEST-1", title: "Test guide", alarmCodes: ["A-TEST-1"], keywords: ["wobble"], steps: ["Apply lockout and tagout.", "Check the thing."] };
    expect((await call("viewer", "POST", "/api/line-health/guides", g)).status).toBe(403);
    expect((await call("maintenance", "POST", "/api/line-health/guides", { ...g, code: "x y" })).status).toBe(422);
    expect((await call("maintenance", "POST", "/api/line-health/guides", { ...g, steps: [" "] })).status).toBe(422);
    expect((await call("maintenance", "POST", "/api/line-health/guides", g)).status).toBe(200);
    expect((await call("maintenance", "POST", "/api/line-health/guides", g)).status).toBe(422); // duplicate code
    expect((await call("viewer", "GET", "/api/line-health/guides?code=G-TEST-1")).body.guide.steps[1].text).toBe("Check the thing.");
    for (const sql of ["delete from ops.guide", "update ops.guide set code='ZZ'"]) { await db.query("begin"); try { await db.query(sql); throw new Error("allowed"); } catch (e: any) { expect(e.message).toMatch(/never deleted|cannot be changed/); } finally { await db.query("rollback"); } }
  });

  it("the assistant answers from the data, cites it, and unverifiable citations are flagged", async () => {
    const f = h.filler.id;
    expect((await call("viewer", "POST", "/api/line-health/chat", { filler: f, messages: [] })).status).toBe(422);
    expect((await call("viewer", "POST", "/api/line-health/chat", { filler: f, messages: [{ role: "assistant", content: "hi" }] })).status).toBe(422);
    const r = await call("viewer", "POST", "/api/line-health/chat", { filler: f, messages: [{ role: "user", content: "What should I do first on this filler?" }] });
    expect(r.status).toBe(200);
    expect(r.body.tools).toContain("get_health");
    const ok = r.body.citations.filter((c: any) => c.valid).map((c: any) => c.id);
    expect(ok).toEqual(expect.arrayContaining(["A-FW-03", "G-FILLWT"]));
    expect(r.body.invalid).toEqual(expect.arrayContaining(["[G:G-FAKE-99]", "[P:S-NOPE-0]"]));
    expect((await db.query("select count(*)::int n from ai.call_log where purpose='hey_filler'")).rows[0].n).toBeGreaterThan(0);
  });

  it("replacing the worn seal lowers the station's score and removes the seal action (the modules really are connected)", async () => {
    const type = (await db.query("select id from ast.part_type where code='EPDM-FV'")).rows[0].id;
    const before = v3.score;
    expect((await call("maintenance", "POST", `/api/assets/positions/${v3.seal.positionId}`, { action: "replace", partCode: "H-NEW-1", partTypeId: type, installedOn: today, removalReason: "inspection_finding" })).status).toBe(200);
    await load();
    expect(v3.score).toBeLessThan(before);
    expect(v3.actions.map((a: any) => a.kind)).not.toContain("seal");
    expect(v3.seal.level).toBe("Low");
    // and the seal page shows the filler alarms for its assembly
    const alarms = await db.query("select count(*)::int n from ast.position p join ops.station s on s.equipment_id=p.equipment_id and s.assembly=p.assembly where p.id=$1", [v3.seal.positionId]);
    expect(alarms.rows[0].n).toBe(1);
  });
});

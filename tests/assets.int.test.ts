/**
 * Asset module (phase 1), end to end. Needs a running server on a freshly seeded database (SEED_MODE=demo):
 *   API_BASE=http://localhost:9361 DATABASE_URL=... npx vitest run tests/assets.int.test.ts
 * It changes one position (L2 / V1-PLUG) and loads one new position through import.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSET_COLUMNS } from "../lib/assetImport";
import { parseCsv, toCsv } from "../lib/csv";

const BASE = process.env.API_BASE;
const run = BASE && process.env.DATABASE_URL ? describe : describe.skip;
let users: Record<string, string> = {};
const call = async (role: string | null, method: string, path: string, data?: unknown) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(role ? { cookie: `baf1_user=${users[role]}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const upload = async (role: string, csv: string, commit: boolean) => {
  const f = new FormData();
  f.append("file", new Blob([csv], { type: "text/csv" }), "a.csv"); if (commit) f.append("commit", "true");
  const r = await fetch(BASE + "/api/assets/import", { method: "POST", headers: { cookie: `baf1_user=${users[role]}` }, body: f });
  return { status: r.status, body: await r.json() };
};
const today = new Date().toISOString().slice(0, 10);

run("asset module", () => {
  let db: Client;
  let pos = "", type = "";
  beforeAll(async () => {
    for (const u of (await call(null, "GET", "/api/session")).body.users) users[u.role] = u.id;
    db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
    pos = (await db.query("select position_id from ast.v_position where line_code='L2' and position_code='V1-PLUG'")).rows[0].position_id;
    type = (await db.query("select id from ast.part_type where code='EPDM-FV'")).rows[0].id;
  });
  afterAll(async () => { await db.end(); });

  it("the demo plant is loaded with the story position", async () => {
    const o = (await call("viewer", "GET", "/api/assets")).body;
    expect(o.kpis.positions).toBe(60);
    expect(o.positions.filter((p: any) => p.age_days > p.nominal_life_days).length).toBeGreaterThan(0);
    const hot = o.positions.find((p: any) => p.line_code === "L1" && p.position_code === "V3-PLUG");
    expect(hot.age_days).toBeGreaterThan(hot.nominal_life_days);
    expect(hot.last_rating).toBe(4);
    expect(hot.incidents_12m).toBeGreaterThan(0);
  });

  it("only the right roles change seals, inspect and report", async () => {
    const body = { action: "replace", partCode: "T-ROLE", partTypeId: type, installedOn: today, removalReason: "planned_replacement" };
    expect((await call("viewer", "POST", `/api/assets/positions/${pos}`, body)).status).toBe(403);
    expect((await call("rd_engineer", "POST", `/api/assets/positions/${pos}`, body)).status).toBe(403);
    expect((await call("viewer", "POST", `/api/assets/positions/${pos}`, { action: "inspect", inspectedOn: today, rating: 2 })).status).toBe(403);
    expect((await call("viewer", "POST", `/api/assets/positions/${pos}`, { action: "incident", occurredOn: today, kind: "leak", severity: "Minor" })).status).toBe(403);
    expect((await call("viewer", "POST", "/api/assets/setup", { action: "partType", code: "X", name: "xx", material: "xx", nominalLifeDays: 10 })).status).toBe(403);
  });

  it("replacing a seal needs a reason, is atomic, and keeps the old seal's history", async () => {
    const before = (await call("viewer", "GET", `/api/assets/positions/${pos}`)).body;
    const oldPart = before.position.part_id;
    const noReason = await call("maintenance", "POST", `/api/assets/positions/${pos}`, { action: "replace", partCode: "T-1", partTypeId: type, installedOn: today });
    expect(noReason.status).toBe(422);
    expect((await call("viewer", "GET", `/api/assets/positions/${pos}`)).body.position.part_id).toBe(oldPart); // nothing half-done
    const back = await call("maintenance", "POST", `/api/assets/positions/${pos}`, { action: "replace", partCode: "T-1", partTypeId: type, installedOn: "2000-01-01", removalReason: "failure" });
    expect(back.status).toBeGreaterThanOrEqual(400); // before the current seal went in
    expect((await db.query("select count(*)::int n from ast.part where code='T-1'")).rows[0].n).toBe(0); // the new part was rolled back too
    const ok = await call("maintenance", "POST", `/api/assets/positions/${pos}`, { action: "replace", partCode: "T-1", partTypeId: type, installedOn: today, removalReason: "inspection_finding", note: "test" });
    expect(ok.status).toBe(200);
    const after = (await call("viewer", "GET", `/api/assets/positions/${pos}`)).body;
    expect(after.position.part_code).toBe("T-1");
    expect(after.position.age_days).toBe(0);
    expect(after.history.length).toBe(before.history.length + 1);
    expect(after.history.find((h: any) => h.part_id === oldPart).removal_reason).toBe("inspection_finding");
    expect((await db.query("select status from ast.part where id=$1", [oldPart])).rows[0].status).toBe("Removed");
    expect((await call("maintenance", "POST", `/api/assets/positions/${pos}`, { action: "replace", partCode: "T-1", partTypeId: type, installedOn: today, removalReason: "failure" })).status).toBeGreaterThanOrEqual(400); // duplicate code
  });

  it("inspections and incidents follow the rules", async () => {
    expect((await call("qa", "POST", `/api/assets/positions/${pos}`, { action: "inspect", inspectedOn: "2999-01-01", rating: 3 })).status).toBe(409);
    expect((await call("qa", "POST", `/api/assets/positions/${pos}`, { action: "inspect", inspectedOn: "2001-01-01", rating: 3 })).status).toBe(409); // before the seal was fitted
    expect((await call("qa", "POST", `/api/assets/positions/${pos}`, { action: "inspect", inspectedOn: today, rating: 6 })).status).toBe(422);
    expect((await call("qa", "POST", `/api/assets/positions/${pos}`, { action: "inspect", inspectedOn: today, rating: 4, finding: "chipped" })).status).toBe(200);
    expect((await call("qa", "POST", `/api/assets/positions/${pos}`, { action: "incident", occurredOn: today, kind: "foreign_body", severity: "Major", description: "fragment" })).status).toBe(200);
    const p = (await call("viewer", "GET", `/api/assets/positions/${pos}`)).body;
    expect(p.position.last_rating).toBe(4);
    expect(p.incidents[0].part_code).toBe("T-1"); // linked to the seal that was in place
    const passport = (await call("viewer", "GET", `/api/assets/parts/${p.position.part_id}`)).body;
    expect(passport.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["installed", "inspection", "incident"]));
  });

  it("the database refuses what the app would never do", async () => {
    const fails = async (sql: string, re: RegExp) => { await db.query("begin"); try { await db.query(sql); throw new Error("allowed: " + sql); } catch (e: any) { expect(e.message).toMatch(re); } finally { await db.query("rollback"); } };
    await fails("delete from ast.installation", /append-only/);
    await fails("update ast.inspection set rating=1", /append-only/);
    await fails("delete from ast.incident", /append-only/);
    await fails("update ast.position set code='ZZ'", /Code cannot be changed/);
    await fails("delete from ast.part", /never deleted/);
    await fails(`update ast.position set status='Retired' where id='${pos}'`, /Remove the seal/);
    await fails(`insert into ast.installation(part_id,position_id,installed_on) select id,'${pos}',current_date from ast.part where status='Available' or true limit 1`, /./); // part not available, or position already has one
    await fails("update ast.installation set installed_on = installed_on + 1 where removed_on is null", /Only the removal/);
    await fails("update ast.installation set removed_on = removed_on - 1 where removed_on is not null", /closed/);
    await fails("update ast.planned_stop set note='x' where status='Done'", /cannot be changed/);
  });

  it("audit names who did what", async () => {
    const r = (await db.query("select e.action, e.entity, u.name from audit.event e join cfg.app_user u on u.id=e.user_id where e.entity like 'ast.%' and e.at > now() - interval '10 minutes' order by e.at")).rows;
    expect(r.some((x) => x.entity === "ast.installation" && x.name.includes("Maintenance"))).toBe(true);
    expect(r.some((x) => x.entity === "ast.incident" && x.name.includes("QA"))).toBe(true);
  });

  it("planned stops: create, validate, close, and a closed stop stays closed", async () => {
    const line = (await call("viewer", "GET", "/api/assets/setup")).body.lines[0].id;
    expect((await call("plant_admin", "POST", "/api/assets/stops", { action: "create", lineId: line, startOn: "2027-03-02", endOn: "2027-03-01", kind: "CIP" })).status).toBe(422);
    expect((await call("viewer", "POST", "/api/assets/stops", { action: "create", lineId: line, startOn: "2027-03-01", endOn: "2027-03-02", kind: "CIP" })).status).toBe(403);
    const made = await call("plant_admin", "POST", "/api/assets/stops", { action: "create", lineId: line, startOn: "2027-03-01", endOn: "2027-03-02", kind: "maintenance", note: "test stop" });
    expect(made.status).toBe(200);
    expect((await call("plant_admin", "POST", "/api/assets/stops", { action: "status", id: made.body.id, status: "Done" })).status).toBe(200);
    expect((await call("plant_admin", "POST", "/api/assets/stops", { action: "status", id: made.body.id, status: "Cancelled" })).status).toBe(409);
  });

  it("setup: codes validate, duplicates refused, part types and positions can be added", async () => {
    const eq = (await call("viewer", "GET", "/api/assets/setup")).body.equipment[0];
    expect((await call("maintenance", "POST", "/api/assets/setup", { action: "position", equipmentId: eq.id, code: "bad code!", name: "xx", assembly: "yy", criticality: 3 })).status).toBe(422);
    const p = await call("maintenance", "POST", "/api/assets/setup", { action: "position", equipmentId: eq.id, code: "TST-POS", name: "Test seal", assembly: "Test assembly", criticality: 2 });
    expect(p.status).toBe(200);
    expect((await call("maintenance", "POST", "/api/assets/setup", { action: "position", equipmentId: eq.id, code: "TST-POS", name: "Test seal", assembly: "Test assembly", criticality: 2 })).status).toBe(422);
    expect((await call("maintenance", "POST", "/api/assets/setup", { action: "partType", code: "TST-PT", name: "Test type", material: "EPDM", nominalLifeDays: 90 })).status).toBe(200);
    // an empty position can be fitted, then retire is refused while a seal sits in it
    const fit = await call("maintenance", "POST", `/api/assets/positions/${p.body.id}`, { action: "replace", partCode: "T-FIT", partTypeId: type, installedOn: today });
    expect(fit.status).toBe(200);
    expect((await call("plant_admin", "POST", `/api/assets/positions/${p.body.id}`, { action: "retire", reason: "no longer used" })).status).toBe(409);
  });

  it("import: template checks pass, bad files are explained, export round-trips", async () => {
    expect((await upload("viewer", "x", false)).status).toBe(403);
    const tmpl = await (await fetch(BASE + "/api/assets/import", { headers: { cookie: `baf1_user=${users.plant_admin}` } })).text();
    const t = (await upload("plant_admin", tmpl, false)).body.check;
    expect(t.ok).toBe(true);
    expect(t.summary).toMatchObject({ rows: 2, positions: 1, openSeals: 1 });

    const rows = parseCsv(tmpl);
    const bad = (mut: (r: string[][]) => void) => { const c = rows.map((r) => [...r]); mut(c); return toCsv(c); };
    const col = (n: (typeof ASSET_COLUMNS)[number]) => ASSET_COLUMNS.indexOf(n);
    const msgs = async (csv: string) => (await upload("plant_admin", csv, false)).body.check.errors.map((e: any) => e.message).join(" | ");
    expect(await msgs(bad((r) => { r[1][col("line_code")] = "L9"; }))).toMatch(/Unknown line/);
    expect(await msgs(bad((r) => { r[1][col("part_type_code")] = "NOPE"; }))).toMatch(/Unknown part type/);
    expect(await msgs(bad((r) => { r[2][col("part_code")] = r[1][col("part_code")]; }))).toMatch(/appears twice/);
    expect(await msgs(bad((r) => { r[1][col("removed_on")] = "2025-01-01"; }))).toMatch(/before installed_on/);
    expect(await msgs(bad((r) => { r[1][col("removal_reason")] = ""; }))).toMatch(/removal_reason must be/);
    expect(await msgs(bad((r) => { r[2][col("installed_on")] = "2026-03-01"; }))).toMatch(/overlaps/);
    expect(await msgs(bad((r) => { r[1][col("removed_on")] = ""; r[1][col("removal_reason")] = ""; }))).toMatch(/still installed but a later one/);
    expect(await msgs(bad((r) => { r[1][col("installed_on")] = "2999-01-01"; r[1][col("removed_on")] = ""; r[1][col("removal_reason")] = ""; }))).toMatch(/future/);
    expect(await msgs(bad((r) => { r[1][col("part_code")] = "T-1"; }))).toMatch(/already exists/);
    expect(await msgs(bad((r) => { r[1][col("criticality")] = "9"; }))).toMatch(/criticality/);
    expect((await upload("plant_admin", "a,b\n1,2\n", false)).status).toBe(422);

    const before = (await db.query("select count(*)::int n from ast.part")).rows[0].n;
    expect((await upload("plant_admin", bad((r) => { r[1][col("line_code")] = "L9"; }), true)).status).toBe(422);
    expect((await db.query("select count(*)::int n from ast.part")).rows[0].n).toBe(before); // a bad file writes nothing

    const done = await upload("plant_admin", tmpl, true);
    expect(done.status).toBe(200);
    expect(done.body.committed).toMatchObject({ positions: 1, parts: 2, equipment: 1 });
    expect((await upload("plant_admin", tmpl, false)).body.check.ok).toBe(false); // loading twice is refused
    const exp = await (await fetch(BASE + "/api/assets/import?export=1", { headers: { cookie: `baf1_user=${users.plant_admin}` } })).text();
    const exported = parseCsv(exp);
    expect(exported[0]).toEqual([...ASSET_COLUMNS]);
    expect(exported.length - 1).toBe((await db.query("select count(*)::int n from ast.installation")).rows[0].n);
    expect(exported.some((r) => r[col("part_code")] === "S-EPDM-FV-90002" && r[col("removed_on")] === "")).toBe(true);
  });
});

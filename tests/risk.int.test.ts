/**
 * Seal risk, alerts and photo inspection, end to end. Needs a running server WITH the mock Claude (node tests/mock-claude.mjs;
 * ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:9999) on a freshly seeded database:
 *   API_BASE=http://localhost:9361 DATABASE_URL=... npx vitest run tests/risk.int.test.ts
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
const form = async (role: string, path: string, fields: Record<string, string | Blob>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) { if (v instanceof Blob) f.append(k, v, "p.png"); else f.append(k, v); }
  const r = await fetch(BASE + path, { method: "POST", headers: { cookie: `baf1_user=${users[role]}` }, body: f });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const png = (tag = "OK") => new Blob([Buffer.from(`\x89PNG\r\n${tag}-photo-bytes-${Math.random()}`)], { type: "image/png" });
const today = new Date().toISOString().slice(0, 10);

run("seal risk", () => {
  let db: Client;
  let board: any, story: any;
  beforeAll(async () => {
    for (const u of (await call(null, "GET", "/api/session")).body.users) users[u.role] = u.id;
    db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  });
  afterAll(async () => { await db.end(); });

  it("refresh needs a role, then scores every seal and raises alerts", async () => {
    expect((await call("viewer", "POST", "/api/risk")).status).toBe(403);
    const r = await call("maintenance", "POST", "/api/risk");
    expect(r.status).toBe(200);
    expect(r.body.scored).toBe(60);
    expect(r.body.raised).toBeGreaterThan(0);
    const again = await call("maintenance", "POST", "/api/risk");
    expect(again.body.raised).toBe(0); // no duplicate alerts
    board = (await call("viewer", "GET", "/api/risk")).body;
    expect(board.counts.High + board.counts.Medium + board.counts.Low).toBe(60);
    expect((await db.query("select count(*)::int n from (select position_id from ast.alert where state in ('New','Acknowledged','Planned','Deferred') group by 1 having count(*)>1) x")).rows[0].n).toBe(0);
  });

  it("the story seal is High because of its inspection and incident, and the breakdown explains it", async () => {
    story = board.ranked.find((r: any) => r.lineCode === "L1" && r.assembly === "Filling valve 3" && r.positionName === "Plug seal");
    expect(story.result.level).toBe("High");
    const pos = (await call("viewer", "GET", "/api/assets")).body.positions.find((p: any) => p.position_id === story.positionId);
    const risk = (await call("viewer", "GET", `/api/assets/positions/${pos.position_id}/risk`)).body.risk;
    expect(risk.projectedDays).toBe(0);
    expect(risk.result.factors.find((f: any) => f.key === "inspection").points).toBeGreaterThan(0);
    expect(risk.recommendedStop.stop).not.toBeNull();
    const sum = risk.result.factors.reduce((a: number, f: any) => a + f.points, 0);
    expect(Math.abs(sum - Math.min(100, risk.result.base * risk.result.multiplier))).toBeLessThan(0.6);
    // the same inputs give the same score twice
    const again = (await call("viewer", "GET", "/api/risk")).body.ranked.find((r: any) => r.positionId === story.positionId);
    expect(again.result.score).toBe(story.result.score);
  });

  it("ranking is sorted and a younger seal with no problems is Low", async () => {
    const s = board.ranked.map((r: any) => r.result.score);
    expect([...s].sort((a, b) => b - a)).toEqual(s);
    expect(board.ranked[board.ranked.length - 1].result.level).toBe("Low");
  });

  it("alert handling follows the rules", async () => {
    const a = board.alerts.find((x: any) => x.position_id === story.positionId);
    expect(a.state).toBe("New");
    expect((await call("viewer", "POST", `/api/risk/alerts/${a.id}`, { to: "Acknowledged" })).status).toBe(403);
    expect((await call("maintenance", "POST", `/api/risk/alerts/${a.id}`, { to: "Dismissed", reason: "not a concern" })).status).toBe(409); // rated damaged + foreign body
    expect((await call("maintenance", "POST", `/api/risk/alerts/${a.id}`, { to: "Done" })).status).toBe(409); // seal not replaced
    expect((await call("maintenance", "POST", `/api/risk/alerts/${a.id}`, { to: "Planned" })).status).toBe(422); // no stop
    const otherLineStop = (await db.query("select s.id from ast.planned_stop s join cfg.line l on l.id=s.line_id where l.code='L2' and s.status='Planned' limit 1")).rows[0].id;
    expect((await call("maintenance", "POST", `/api/risk/alerts/${a.id}`, { to: "Planned", stopId: otherLineStop })).status).toBe(422);
    expect((await call("maintenance", "POST", `/api/risk/alerts/${a.id}`, { to: "Deferred", reason: "wait" })).status).toBeGreaterThanOrEqual(400);
    expect((await call("maintenance", "POST", `/api/risk/alerts/${a.id}`, { to: "Acknowledged" })).status).toBe(200);
    const stop = board.stops.L1.find((s: any) => s.kind === "maintenance");
    expect((await call("maintenance", "POST", `/api/risk/alerts/${a.id}`, { to: "Planned", stopId: stop.id })).status).toBe(200);
    const st = (await call("viewer", "GET", "/api/risk")).body.alerts.find((x: any) => x.id === a.id);
    expect(st.state).toBe("Planned"); expect(st.stop_start).toBe(stop.start_on);
  });

  it("a dismissible alert can be dismissed with a reason; the audit names the person", async () => {
    const b = (await call("viewer", "GET", "/api/risk")).body;
    const m = b.alerts.find((x: any) => x.state === "New" && x.level !== "High") ?? b.alerts.find((x: any) => x.state === "New" && x.position_id !== story.positionId);
    expect(m).toBeTruthy();
    const pos = m.position_id;
    const blocked = (await db.query("select (select rating from ast.inspection where installation_id=$1 order by inspected_on desc limit 1) as r, exists(select 1 from ast.incident where position_id=$2 and kind='foreign_body' and occurred_on>=current_date-30) as fb", [m.installation_id, pos])).rows[0];
    const res = await call("qa", "POST", `/api/risk/alerts/${m.id}`, { to: "Dismissed", reason: "Checked on the line, seal in good order" });
    if ((blocked.r ?? 0) >= 4 || blocked.fb) expect(res.status).toBe(409); else expect(res.status).toBe(200);
    expect((await call("qa", "POST", `/api/risk/alerts/${m.id}`, { to: "Dismissed", reason: "abc" })).status).toBeGreaterThanOrEqual(400); // reason too short (or already closed)
    const au = (await db.query("select count(*)::int n from audit.event e join cfg.app_user u on u.id=e.user_id where e.entity='ast.alert' and u.role in ('maintenance','qa')")).rows[0].n;
    expect(au).toBeGreaterThan(0);
  });

  it("replacing the seal closes its alert on the next refresh, and the database refuses closed-alert edits", async () => {
    const type = (await db.query("select id from ast.part_type where code='EPDM-FV'")).rows[0].id;
    expect((await call("maintenance", "POST", `/api/assets/positions/${story.positionId}`, { action: "replace", partCode: "R-NEW-1", partTypeId: type, installedOn: today, removalReason: "inspection_finding", note: "chipped" })).status).toBe(200);
    const r = await call("maintenance", "POST", "/api/risk");
    expect(r.body.closedByReplacement).toBeGreaterThanOrEqual(1);
    const a = (await db.query("select state from ast.alert where position_id=$1 order by created_at desc limit 1", [story.positionId])).rows[0];
    expect(a.state).toBe("Done");
    const fails = async (sql: string, re: RegExp) => { await db.query("begin"); try { await db.query(sql); throw new Error("allowed: " + sql); } catch (e: any) { expect(e.message).toMatch(re); } finally { await db.query("rollback"); } };
    await fails("update ast.alert set state='New' where state='Done'", /cannot go from|cannot be changed/);
    await fails("delete from ast.alert", /never deleted/);
    const now = (await call("viewer", "GET", `/api/assets/positions/${story.positionId}/risk`)).body.risk;
    expect(now.result.level).toBe("Low"); // a new seal starts low
  });

  it("weights: roles, validation, effect, audit", async () => {
    const w = board.weights;
    expect((await call("viewer", "POST", "/api/risk/weights", { weights: w, reason: "test change" })).status).toBe(403);
    expect((await call("plant_admin", "POST", "/api/risk/weights", { weights: { ...w, age: 9 }, reason: "test change" })).status).toBe(422);
    expect((await call("plant_admin", "POST", "/api/risk/weights", { weights: { ...w, age: 2.5 }, reason: "test change" })).status).toBe(422);
    expect((await call("plant_admin", "POST", "/api/risk/weights", { weights: w, reason: "no" })).status).toBe(422);
    const zero = Object.fromEntries(Object.keys(w).map((k) => [k, 0]));
    expect((await call("plant_admin", "POST", "/api/risk/weights", { weights: zero, reason: "all zero" })).status).toBe(422);
    const target = (await call("viewer", "GET", "/api/risk")).body.ranked.find((r: any) => r.result.factors.find((f: any) => f.label.startsWith("Age") && f.points > 0));
    const before = target.result.score;
    expect((await call("plant_admin", "POST", "/api/risk/weights", { weights: { ...w, age: 0 }, reason: "test: ignore age" })).status).toBe(200);
    const after = (await call("viewer", "GET", "/api/risk")).body.ranked.find((r: any) => r.positionId === target.positionId);
    expect(after.result.factors.find((f: any) => f.label.startsWith("Age")).points).toBe(0);
    expect(after.result.score).not.toBe(before);
    expect((await call("plant_admin", "POST", "/api/risk/weights", { weights: w, reason: "test: restore" })).status).toBe(200);
    expect((await db.query("select count(*)::int n from audit.event where entity='ast.risk_config'")).rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it("backtest runs and reports honestly", async () => {
    const b = (await call("viewer", "GET", "/api/risk/backtest")).body;
    expect(b.failures).toBeGreaterThan(0);
    expect(b.engine.highOfFailures).toBeLessThanOrEqual(b.engine.mediumUpOfFailures);
    expect(b.engine.mediumUpOfFailures).toBeLessThanOrEqual(b.failures);
    expect(b.note).toMatch(/synthetic/);
  });

  it("photo inspection: the assessment can raise but not lower, and is tied to the photo", async () => {
    const pos = board.ranked.find((r: any) => r.positionId !== story.positionId && r.result.level === "Low").positionId;
    const url = `/api/assets/positions/${pos}/inspection`;
    expect((await form("viewer", "/api/assets/photo-analyse", { photo: png() })).status).toBe(403);
    expect((await form("qa", "/api/assets/photo-analyse", { photo: new Blob(["x"], { type: "text/plain" }) })).status).toBe(422);
    const blurry = await form("qa", "/api/assets/photo-analyse", { photo: new Blob([Buffer.from("BLUR\0\0\0\0\0")], { type: "image/png" }) });
    expect(blurry.body.usable).toBe(false);
    const photo = png();
    const an = (await form("qa", "/api/assets/photo-analyse", { photo })).body;
    expect(an.usable).toBe(true); expect(an.rating).toBe(4);
    // lower than the assessment, no reason: refused by the database rule
    const low = await form("qa", url, { inspectedOn: today, rating: "2", photo, analysisId: an.analysisId });
    expect(low.status).toBe(409);
    expect((await db.query("select count(*)::int n from ast.inspection where ai_analysis_id=$1", [an.analysisId])).rows[0].n).toBe(0);
    // someone else cannot use the assessment; a different photo cannot either
    expect((await form("maintenance", url, { inspectedOn: today, rating: "4", photo, analysisId: an.analysisId })).status).toBe(403);
    expect((await form("qa", url, { inspectedOn: today, rating: "4", photo: png("OTHER"), analysisId: an.analysisId })).status).toBe(422);
    // lower with a reason is allowed and recorded
    const ok = await form("qa", url, { inspectedOn: today, rating: "2", photo, analysisId: an.analysisId, overrideReason: "Mark is a stain, wiped off and checked by touch" });
    expect(ok.status).toBe(200); expect(ok.body.aiRating).toBe(4);
    const row = (await db.query("select rating, ai_rating, override_reason from ast.inspection where id=$1", [ok.body.id])).rows[0];
    expect(row).toMatchObject({ rating: 2, ai_rating: 4 });
    expect(row.override_reason).toMatch(/stain/);
    // the photo is stored and served back unchanged
    const got = await fetch(BASE + `/api/assets/inspections/${ok.body.id}/photo`);
    expect(got.status).toBe(200); expect(got.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await got.arrayBuffer()).equals(Buffer.from(await photo.arrayBuffer()))).toBe(true);
    // raising above the assessment needs nothing; no photo is fine too
    const photo2 = png();
    const an2 = (await form("qa", "/api/assets/photo-analyse", { photo: photo2 })).body;
    expect((await form("qa", url, { inspectedOn: today, rating: "5", photo: photo2, analysisId: an2.analysisId })).status).toBe(200);
    expect((await form("qa", url, { inspectedOn: today, rating: "3" })).status).toBe(200);
    // photos cannot be changed
    await db.query("begin"); try { await db.query("update ast.inspection_photo set content_type='image/jpeg'"); throw new Error("allowed"); } catch (e: any) { expect(e.message).toMatch(/append-only/); } finally { await db.query("rollback"); }
    // the call log keeps the hash, not the image
    const log = (await db.query("select request from ai.call_log where purpose='seal_photo' order by created_at desc limit 1")).rows[0].request;
    expect(JSON.stringify(log)).toMatch(/photo_sha/); expect(JSON.stringify(log).length).toBeLessThan(500);
  });
});

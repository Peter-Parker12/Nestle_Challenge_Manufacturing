/**
 * Plant view (phase 4): line status, launch banner data, Ask the plant. Needs a running server WITH the mock Claude
 * (node tests/mock-claude.mjs; ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:9999) on a freshly seeded database:
 *   API_BASE=http://localhost:9361 DATABASE_URL=... npx vitest run tests/plant.int.test.ts
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

run("plant view", () => {
  let db: Client;
  beforeAll(async () => {
    for (const u of (await call(null, "GET", "/api/session")).body.users) users[u.role] = u.id;
    db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  });
  afterAll(async () => { await db.end(); });

  it("gives every line a status that joins seals and filler health", async () => {
    const r = await call("viewer", "GET", "/api/plant");
    expect(r.status).toBe(200);
    const lines = r.body.lines;
    expect(lines.map((l: any) => l.code)).toEqual(expect.arrayContaining(["L1", "L2", "L3"]));
    const l1 = lines.find((l: any) => l.code === "L1");
    expect(l1.state).toBe("Attention");
    expect(l1.filler.stationCode).toBe("V3");
    expect(l1.seals.high).toBeGreaterThan(0);
    expect(l1.reasons.length).toBeGreaterThan(0);
    const l3 = lines.find((l: any) => l.code === "L3");
    expect(l3.state).toBe("OK"); // empty line: no seals, no filler, no concerns
  });

  it("the launch page shows a banner for the launch's line, and none for a closed launch", async () => {
    const open = (await db.query(`select l.id, ln.code from core.launch_project l join cfg.line ln on ln.id=l.line_id where l.status not in ('Closed','Cancelled') and ln.code='L1' limit 1`)).rows[0];
    const closed = (await db.query(`select l.id from core.launch_project l where l.status='Closed' limit 1`)).rows[0];
    if (open) {
      const html = await (await fetch(`${BASE}/launches/${open.id}`, { headers: { cookie: `baf1_user=${users.viewer}` } })).text();
      expect(html).toContain("Line L1");
      expect(html).toContain("does not change the launch");
    }
    if (closed) {
      const html = await (await fetch(`${BASE}/launches/${closed.id}`, { headers: { cookie: `baf1_user=${users.viewer}` } })).text();
      expect(html).not.toContain("does not change the launch");
    }
  });

  it("reading the plant status writes nothing (no audit events)", async () => {
    const before = (await call("viewer", "GET", "/api/plant")).body.lines.find((l: any) => l.code === "L1");
    const audit = Number((await db.query(`select count(*) from audit.event`)).rows[0].count);
    await call("viewer", "GET", "/api/plant");
    expect(Number((await db.query(`select count(*) from audit.event`)).rows[0].count)).toBe(audit); // reading writes no audit
    expect(before.seals.high).toBeGreaterThanOrEqual(0);
  });

  it("Ask the plant answers with checked citations: unverifiable ones are flagged", async () => {
    const r = await call("viewer", "POST", "/api/plant/chat", { messages: [{ role: "user", content: "Which line should I worry about?" }] });
    expect(r.status).toBe(200);
    expect(r.body.tools).toContain("get_plant_status");
    expect(r.body.invalid).toEqual(expect.arrayContaining(["[P:S-NOPE-1]", "[L:L-9998]"]));
    expect(r.body.text).toContain("not a certainty");
  });

  it("chat refuses a conversation that does not end with a user message", async () => {
    expect((await call("viewer", "POST", "/api/plant/chat", { messages: [{ role: "assistant", content: "hi" }] })).status).toBe(422);
  });
});

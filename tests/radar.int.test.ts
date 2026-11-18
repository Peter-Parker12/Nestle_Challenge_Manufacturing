/**
 * Market Move Radar end to end. Needs a running server WITH the mock Claude (node tests/mock-claude.mjs;
 * ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:9999) on a freshly seeded database:
 *   API_BASE=http://localhost:9361 DATABASE_URL=... npx vitest run tests/radar.int.test.ts
 */
import sharp from "sharp";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.API_BASE;
const run = BASE && process.env.DATABASE_URL ? describe : describe.skip;
let users: Record<string, string> = {};
const call = async (role: string | null, method: string, path: string, data?: unknown) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(role ? { cookie: `radar_user=${users[role]}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const upload = async (role: string, png: Buffer, retailerId: string) => {
  const f = new FormData(); f.set("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "shelf.png"); f.set("retailerId", retailerId); f.set("takenOn", new Date().toISOString().slice(0, 10));
  const res = await fetch(BASE + "/api/photos", { method: "POST", headers: { cookie: `radar_user=${users[role]}` }, body: f });
  return { status: res.status, body: await res.json().catch(() => null) };
};

run("Market Move Radar", () => {
  let db: Client;
  let moves: any[];
  const move = (kind: string) => moves.find((m) => m.kind === kind);
  beforeAll(async () => {
    for (const u of (await call(null, "GET", "/api/session")).body.users) users[u.role] = u.id;
    db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
    moves = (await call("viewer", "GET", "/api/moves")).body.moves;
  });
  afterAll(async () => { await db.end(); });

  it("finds all six planted moves and ranks them by exposure", () => {
    expect(moves.map((m) => m.kind).sort()).toEqual(["out_of_stock", "pack_change", "price_cut", "price_cut", "price_rise", "promo"].sort());
    const ex = moves.map((m) => m.exposure_vnd);
    expect(ex).toEqual([...ex].sort((a, b) => b - a));
    const cut = moves.find((m) => m.kind === "price_cut" && m.channel_code === "MT");
    expect(cut.sku_code).toBe("A-UHT-1L"); expect(cut.level).toBe("High"); expect(Number(cut.change_pct)).toBeLessThan(-9);
    expect(move("price_rise").level).toBe("Low");
    expect(move("promo").channel_code).toBe("ECOM");
    expect(move("pack_change").level).not.toBe("High");
  });

  it("the overview adds the price index, feeds and counts", async () => {
    const o = (await call("viewer", "GET", "/api/radar")).body;
    expect(o.moves.length).toBe(moves.length);
    expect(o.priceIndex.length).toBe(3);
    expect(o.feeds.length).toBe(4);
    expect(o.counts.High + o.counts.Medium + o.counts.Low).toBe(moves.length);
  });

  it("a move has evidence, a chart, an elasticity estimate and ordered scenario ranges", async () => {
    const cut = moves.find((m) => m.kind === "price_cut" && m.channel_code === "MT");
    const d = (await call("viewer", "GET", `/api/moves/${cut.code}`)).body;
    expect(d.scenarios.map((s: any) => s.label)).toEqual(["A", "B", "C", "D"]);
    for (const s of d.scenarios) { expect(s.volume_low).toBeLessThanOrEqual(s.volume_pct + 0.06); expect(s.volume_high).toBeGreaterThanOrEqual(s.volume_pct - 0.06); expect(s.assumptions.elasticity).toBeLessThan(0); }
    expect(d.scenarios.find((s: any) => s.label === "C").needs_category_manager).toBe(true);
    expect(d.elasticity.method).toBe("log-log");
    expect(d.elasticity.value).toBeGreaterThan(-2.0); expect(d.elasticity.value).toBeLessThan(-1.3); // the seed's true value is -1.6
    expect(d.chart.series.length).toBeGreaterThan(10);
    expect(d.evidence.some((e: any) => e.obsId)).toBe(true);
    expect(d.move.exposure_low).toBeLessThan(d.move.exposure_vnd);
    const oos = (await call("viewer", "GET", `/api/moves/${move("out_of_stock").code}`)).body;
    expect(oos.scenarios.map((s: any) => s.kind)).toEqual(["hold", "restock"]);
    expect((await call("viewer", "GET", "/api/moves/M-9999")).status).toBe(404);
  });

  it("refreshing again adds nothing: a known move is not duplicated", async () => {
    const r = await call("analyst", "POST", "/api/radar/refresh");
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(0);
    expect(r.body.existing).toBe(moves.length);
    expect((await call("viewer", "POST", "/api/radar/refresh")).status).toBe(403);
  });

  describe("decisions", () => {
    let code: string;
    beforeAll(() => { code = moves.find((m) => m.kind === "price_cut" && m.channel_code === "MT").code; });
    it("only a sales lead or category manager can decide", async () => {
      for (const role of ["viewer", "field_rep", "analyst"]) expect((await call(role, "POST", `/api/moves/${code}/decision`, { label: "B", action: "Accepted" })).status, role).toBe(403);
    });
    it("a reject or defer needs a reason, and a defer needs a future date (database rules)", async () => {
      expect((await call("sales_lead", "POST", `/api/moves/${code}/decision`, { label: "A", action: "Rejected" })).status).toBe(409);
      expect((await call("sales_lead", "POST", `/api/moves/${code}/decision`, { label: "A", action: "Deferred", reason: "wait a week" })).status).toBe(409);
      const past = (await call("sales_lead", "POST", `/api/moves/${code}/decision`, { label: "A", action: "Deferred", reason: "wait a week", deferUntil: "2020-01-01" }));
      expect(past.status).toBe(409); expect(past.body.message).toMatch(/future/);
      expect((await call("sales_lead", "POST", `/api/moves/${code}/decision`, { label: "Z", action: "Accepted" })).status).toBe(404);
    });
    it("a price match can only be accepted by a category manager", async () => {
      const r = await call("sales_lead", "POST", `/api/moves/${code}/decision`, { label: "C", action: "Accepted" });
      expect(r.status).toBe(409); expect(r.body.message).toMatch(/category manager/);
    });
    it("a decision is recorded, shown as the move's status, and cannot be edited or deleted", async () => {
      expect((await call("sales_lead", "POST", `/api/moves/${code}/decision`, { label: "B", action: "Accepted" })).status).toBe(200);
      let d = (await call("viewer", "GET", `/api/moves/${code}`)).body;
      expect(d.move.status).toBe("Accepted"); expect(d.decisions[0].by_name).toMatch(/Linh/);
      const later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      expect((await call("category_manager", "POST", `/api/moves/${code}/decision`, { label: "C", action: "Deferred", reason: "wait for the next price list", deferUntil: later })).status).toBe(200);
      d = (await call("viewer", "GET", `/api/moves/${code}`)).body;
      expect(d.move.status).toBe("Deferred"); expect(d.decisions.length).toBe(2); // history is kept
      await expect(db.query(`update mkt.decision set action='Rejected' where move_id=(select id from mkt.move where code=$1)`, [code])).rejects.toThrow(/append-only/);
      await expect(db.query(`delete from mkt.decision`)).rejects.toThrow(/append-only/);
      expect((await call("category_manager", "POST", `/api/moves/${code}/decision`, { label: "C", action: "Accepted" })).status).toBe(200);
    });
  });

  describe("shelf photos", () => {
    let store: string, mock: string, items: any[];
    beforeAll(async () => {
      store = (await call("viewer", "GET", "/api/setup")).body.retailers.find((r: any) => r.code === "GT-4").id;
      mock = (await call("field_rep", "POST", "/api/photos/mock")).body.id;
    });
    it("a mock photo is stored as an image, with its hash, and is immutable", async () => {
      expect(mock).toBeTruthy();
      const img = await fetch(`${BASE}/api/photos/${mock}/image`);
      expect(img.status).toBe(200); expect(img.headers.get("content-type")).toBe("image/png");
      expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(5000);
      await expect(db.query(`update mkt.photo set taken_on=taken_on - 1 where id=$1`, [mock])).rejects.toThrow(/append-only/);
      expect((await call("viewer", "POST", "/api/photos/mock")).status).toBe(403);
    });
    it("Claude's reading is stored beside, not instead of, the person's check; doubtful tags are held", async () => {
      const r = await call("field_rep", "POST", `/api/photos/${mock}/read`);
      expect(r.status).toBe(200); expect(r.body.items).toBe(5);
      items = (await call("viewer", "GET", `/api/photos/${mock}`)).body.items;
      const by = (code: string) => items.find((i: any) => i.sku_code === code);
      expect(by("N-RTD-180").needs_check).toBe(false);
      expect(by("N-YOG-4").ai_price).toBeNull(); expect(by("N-YOG-4").needs_check).toBe(true); // a covered tag is not guessed
      expect(by("N-UHT-1L").ai_price).toBe(125000); expect(by("N-UHT-1L").needs_check).toBe(true); expect(by("N-UHT-1L").ai_conf).toBeLessThanOrEqual(0.5); // far outside the usual range
      expect(items.find((i: any) => !i.sku_code).needs_check).toBe(true); // not a tracked product
      expect((await call("field_rep", "POST", `/api/photos/${mock}/read`)).status).toBe(409); // read once
    });
    it("confirming adds a price observation; the AI value is never changed", async () => {
      const it = items.find((i: any) => i.sku_code === "N-RTD-180");
      expect((await call("field_rep", "POST", `/api/photo-items/${it.id}`, { action: "confirm" })).status).toBe(200);
      const o = (await db.query(`select o.* from mkt.observation o where o.id=(select observation_id from mkt.photo_item where id=$1)`, [it.id])).rows[0];
      expect(o.source).toBe("shelf_photo"); expect(Number(o.price)).toBe(11500);
      expect((await call("field_rep", "POST", `/api/photo-items/${it.id}`, { action: "confirm" })).status).toBe(409); // already checked
      await expect(db.query(`update mkt.photo_item set ai_price=1 where id=$1`, [it.id])).rejects.toThrow();
      await expect(db.query(`update mkt.observation set price=1 where id=$1`, [o.id])).rejects.toThrow(/append-only/);
    });
    it("a tag with no price cannot be confirmed; a correction needs a different price and a reason", async () => {
      const cov = items.find((i: any) => i.sku_code === "N-YOG-4");
      expect((await call("field_rep", "POST", `/api/photo-items/${cov.id}`, { action: "confirm" })).status).toBe(422); // nothing to confirm
      expect((await call("field_rep", "POST", `/api/photo-items/${cov.id}`, { action: "correct", price: 28000 })).status).toBe(409); // no reason
      const ok = await call("field_rep", "POST", `/api/photo-items/${cov.id}`, { action: "correct", price: 28000, reason: "Read from the photo" });
      expect(ok.status).toBe(200);
      const wrong = items.find((i: any) => i.sku_code === "N-UHT-1L");
      expect((await call("field_rep", "POST", `/api/photo-items/${wrong.id}`, { action: "correct", price: 125000, reason: "same as AI" })).status).toBe(409); // equals the AI value
      expect((await call("field_rep", "POST", `/api/photo-items/${wrong.id}`, { action: "correct", price: 25400, reason: "AI misread a digit" })).status).toBe(200);
      const row = (await call("viewer", "GET", `/api/photos/${mock}`)).body.items.find((i: any) => i.id === wrong.id);
      expect(row.ai_price).toBe(125000); expect(row.human_price).toBe(25400); expect(row.status).toBe("Corrected");
    });
    it("marking a reading unreadable adds no price; a viewer cannot check", async () => {
      const un = items.find((i: any) => !i.sku_code);
      const before = Number((await db.query(`select count(*) from mkt.observation`)).rows[0].count);
      expect((await call("viewer", "POST", `/api/photo-items/${un.id}`, { action: "unreadable" })).status).toBe(403);
      expect((await call("field_rep", "POST", `/api/photo-items/${un.id}`, { action: "unreadable", reason: "not ours" })).status).toBe(200);
      expect(Number((await db.query(`select count(*) from mkt.observation`)).rows[0].count)).toBe(before);
    });
    it("a tiny or blurred photo is declined and the same photo cannot be added twice", async () => {
      const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).png().toBuffer();
      const up = await upload("field_rep", tiny, store);
      expect(up.status).toBe(200);
      const r = await call("field_rep", "POST", `/api/photos/${up.body.id}/read`);
      expect(r.status).toBe(200); expect(r.body.usable).toBe(false); expect(r.body.items).toBe(0);
      expect((await upload("field_rep", tiny, store)).status).toBe(409);
      expect((await upload("viewer", tiny, store)).status).toBe(403);
      const bad = new FormData(); bad.set("file", new Blob(["not an image"], { type: "text/plain" }), "x.txt"); bad.set("retailerId", store);
      expect((await fetch(`${BASE}/api/photos`, { method: "POST", headers: { cookie: `radar_user=${users.field_rep}` }, body: bad })).status).toBe(422);
    });
  });

  describe("brief and Ask the radar", () => {
    it("a brief is stored, and citations that are not in the data are flagged", async () => {
      const r = await call("analyst", "POST", "/api/briefs", { language: "en" });
      expect(r.status).toBe(200); expect(r.body.source).toBe("claude");
      const b = (await call("viewer", "GET", `/api/briefs/${r.body.id}`)).body;
      expect(b.sections.length).toBeGreaterThan(0);
      expect(b.invalid).toEqual(expect.arrayContaining(["[M:M-9999]", "[O:99999999]"]));
      const valid = b.citations.filter((c: any) => c.valid).map((c: any) => c.id);
      expect(valid.length).toBeGreaterThan(0); expect(valid.every((id: string) => moves.some((m) => m.code === id))).toBe(true);
      await expect(db.query(`update mkt.brief set headline='x' where id=$1`, [r.body.id])).rejects.toThrow(/append-only/);
      expect((await call("viewer", "POST", "/api/briefs", { language: "en" })).status).toBe(403);
      expect((await call("viewer", "GET", "/api/briefs")).body.briefs.length).toBeGreaterThan(0);
    });
    it("Ask the radar uses read-only tools, flags a fake citation and logs the call", async () => {
      const r = await call("viewer", "POST", "/api/ask", { messages: [{ role: "user", content: "What is the biggest move?" }] });
      expect(r.status).toBe(200);
      expect(r.body.tools).toContain("get_moves");
      expect(r.body.invalid).toEqual(["[M:M-9999]"]);
      expect(r.body.citations.filter((c: any) => c.valid).length).toBeGreaterThan(0);
      expect(r.body.text).toMatch(/estimate/);
      expect(Number((await db.query(`select count(*) from ai.call_log where purpose='ask_radar' and output_valid`)).rows[0].count)).toBeGreaterThan(0);
      expect((await call("viewer", "POST", "/api/ask", { messages: [{ role: "assistant", content: "hi" }] })).status).toBe(422);
    });
  });

  describe("settings, history and audit", () => {
    it("settings change only with a reason and inside the allowed range, by the right role, and are audited", async () => {
      expect((await call("viewer", "POST", "/api/settings", { key: "gross_margin", value: 0.3, reason: "Finance confirmed" })).status).toBe(403);
      expect((await call("category_manager", "POST", "/api/settings", { key: "gross_margin", value: 0.3, reason: "x" })).status).toBe(422);
      expect((await call("category_manager", "POST", "/api/settings", { key: "gross_margin", value: 5, reason: "Finance confirmed" })).status).toBe(422);
      expect((await call("category_manager", "POST", "/api/settings", { key: "nope", value: 1, reason: "Finance confirmed" })).status).toBe(404);
      expect((await call("category_manager", "POST", "/api/settings", { key: "gross_margin", value: 0.3, reason: "Finance confirmed 30%" })).status).toBe(200);
      const s = (await call("viewer", "GET", "/api/settings")).body.settings.find((x: any) => x.key === "gross_margin");
      expect(Number(s.value)).toBe(0.3);
      const ev = (await db.query(`select reason from audit.event where entity='cfg.setting' and entity_id='gross_margin' order by id desc limit 1`)).rows[0];
      expect(ev.reason).toBe("Finance confirmed 30%");
      await call("category_manager", "POST", "/api/settings", { key: "gross_margin", value: 0.32, reason: "Restore the demo value" });
    });
    it("price, sales and move history cannot be edited or deleted", async () => {
      await expect(db.query(`delete from mkt.observation`)).rejects.toThrow(/append-only/);
      await expect(db.query(`update mkt.sales_weekly set units=0`)).rejects.toThrow(/append-only/);
      await expect(db.query(`update mkt.move set level='Low'`)).rejects.toThrow(/append-only/);
      await expect(db.query(`update mkt.scenario set label='Z'`)).rejects.toThrow(/append-only/);
    });
    it("the audit log is for sales leads, category managers and admins", async () => {
      expect((await call("viewer", "GET", "/api/audit")).status).toBe(403);
      const a = await call("sales_lead", "GET", "/api/audit");
      expect(a.status).toBe(200); expect(a.body.events.length).toBeGreaterThan(5);
    });
    it("the backtest replays the planted events and says what it proves", async () => {
      const b = (await call("viewer", "GET", "/api/backtest")).body;
      expect(b.total).toBe(8);
      expect(b.caught).toBeGreaterThanOrEqual(6);
      expect(b.note).toMatch(/Synthetic/);
    });
  });
});

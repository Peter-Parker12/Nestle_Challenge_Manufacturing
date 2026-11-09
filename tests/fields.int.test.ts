/**
 * Custom product fields, end to end. Needs a running server on a freshly seeded database:
 *   API_BASE=http://localhost:9361 npx vitest run tests/fields.int.test.ts
 * It cleans up after itself by retiring the fields it creates.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../lib/csv";

const BASE = process.env.API_BASE;
const run = BASE ? describe : describe.skip;
let users: Record<string, string> = {};
const call = async (role: string | null, method: string, path: string, data?: unknown) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(role ? { cookie: `baf1_user=${users[role]}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const upload = async (role: string, path: string, csv: string, dryRun: boolean) => {
  const f = new FormData();
  f.append("file", new Blob([csv], { type: "text/csv" }), "b.csv"); f.append("dryRun", String(dryRun));
  const r = await fetch(BASE + path, { method: "POST", headers: { cookie: `baf1_user=${users[role]}` }, body: f });
  return { status: r.status, body: await r.json() };
};

run("custom product fields", () => {
  let cat = "", line = "";
  const F: Record<string, string> = {};
  const fields = async () => (await call("category_owner", "GET", `/api/categories/${cat}/fields`)).body;
  const find = async (code: string) => (await fields()).fields.find((f: any) => f.code === code);
  const newLaunch = async (name: string, attrs: Record<string, unknown>) =>
    call("rd_engineer", "POST", "/api/launches", { categoryId: cat, lineId: line, name, attrs: { viscosity_cp: 30, fat_pct: 2, solids_pct: 12, base: "milk", ...attrs }, specs: {} });

  beforeAll(async () => {
    for (const u of (await call(null, "GET", "/api/session")).body.users) users[u.role] = u.id;
    const meta = (await call("rd_engineer", "GET", "/api/launches")).body;
    cat = meta.categories.find((c: any) => c.code === "UHT_DRINK").id;
    line = meta.lines[0].id;
  });

  it("only the category owner defines fields, and the input is validated", async () => {
    const good = { code: "pack_type", name: "Pack type", type: "choice", choices: ["carton", "pouch"], initialWeight: 0 };
    expect((await call("rd_engineer", "POST", `/api/categories/${cat}/fields`, good)).status).toBe(403);
    expect((await call("plant_admin", "POST", `/api/categories/${cat}/fields`, good)).status).toBe(403);
    expect((await call("category_owner", "POST", `/api/categories/${cat}/fields`, { ...good, code: "Pack Type" })).status).toBe(422);
    expect((await call("category_owner", "POST", `/api/categories/${cat}/fields`, { ...good, choices: ["one"] })).status).toBe(422);
    const r = await call("category_owner", "POST", `/api/categories/${cat}/fields`, good);
    expect(r.status).toBe(200);
    F.pack = r.body.id;
    expect((await call("category_owner", "POST", `/api/categories/${cat}/fields`, good)).status).toBe(409);
  });

  it("starts as a Draft with weight 0 and does not appear on forms", async () => {
    const f = await find("pack_type");
    expect(f.status).toBe("Draft");
    expect(f.weight).toBe(0);
    expect(f.coverage).toBe(0);
    expect(f.usedForMatching).toBe(false);
    const cfg = (await call("rd_engineer", "GET", `/api/categories/${cat}/config`)).body;
    expect(cfg.attrDefs.some((a: any) => a.code === "pack_type")).toBe(false);
    expect((await newLaunch("Draft field ignored", { pack_type: "carton" })).status).toBe(200); // unknown/draft field is simply not stored
  });

  it("back-fills values for existing launches: check first, then apply", async () => {
    const tpl = await (await fetch(`${BASE}/api/categories/${cat}/fields/backfill-template`, { headers: { cookie: `baf1_user=${users.category_owner}` } })).text();
    const rows = parseCsv(tpl);
    const col = rows[0].indexOf("attr_pack_type");
    expect(col).toBeGreaterThan(1);
    expect((await fetch(`${BASE}/api/categories/${cat}/fields/backfill-template`, { headers: { cookie: `baf1_user=${users.rd_engineer}` } })).status).toBe(403);
    const filled = rows.map((r, i) => (i === 0 ? r : r.map((c, k) => (k === col ? (i % 2 ? "carton" : "pouch") : c))));
    const bad = filled.map((r, i) => (i === 2 ? r.map((c, k) => (k === col ? "bottle" : c)) : r));
    const badRun = await upload("category_owner", `/api/categories/${cat}/fields/backfill`, toCsv(bad), true);
    expect(badRun.body.errors[0].message).toMatch(/not one of/);
    expect((await upload("category_owner", `/api/categories/${cat}/fields/backfill`, toCsv(bad), false)).body.applied).toBe(false); // errors block the write
    const dry = await upload("category_owner", `/api/categories/${cat}/fields/backfill`, toCsv(filled), true);
    expect(dry.body.errors).toEqual([]);
    expect(dry.body.newValues).toBe(rows.length - 1);
    expect(dry.body.applied).toBe(false);
    expect((await find("pack_type")).acceptedWithValue).toBe(0); // dry run wrote nothing
    const done = await upload("category_owner", `/api/categories/${cat}/fields/backfill`, toCsv(filled), false);
    expect(done.body.applied).toBe(true);
    const f = await find("pack_type");
    expect(f.coverage).toBeGreaterThan(0.99);
    expect((await upload("category_owner", `/api/categories/${cat}/fields/backfill`, toCsv(filled), false)).body.warnings[0].message).toMatch(/already stored/);
  });

  it("activation puts the field on forms and validates its values", async () => {
    expect((await call("rd_engineer", "PATCH", `/api/categories/${cat}/fields/${F.pack}`, { action: "activate" })).status).toBe(403);
    expect((await call("category_owner", "PATCH", `/api/categories/${cat}/fields/${F.pack}`, { action: "activate" })).status).toBe(200);
    expect((await find("pack_type")).usedForMatching).toBe(true);
    expect((await newLaunch("Bad pack", { pack_type: "bottle" })).body.message).toMatch(/not one of/);
    const ok = await newLaunch("Good pack", { pack_type: "pouch" });
    expect(ok.status).toBe(200);
    const d = (await call("rd_engineer", "GET", `/api/launches/${ok.body.id}`)).body;
    expect(d.attrs.pack_type).toBe("pouch");
    expect(d.attrDefs.some((a: any) => a.code === "pack_type")).toBe(true);
  });

  it("a weighted custom field takes part in the recommendation", async () => {
    expect((await call("category_owner", "POST", `/api/categories/${cat}/weights`, { attributes: { pack_type: 5 }, parameters: {}, reason: "Pack type matters for fill temperature" })).status).toBe(200);
    expect((await find("pack_type")).weight).toBe(5);
    const l = await newLaunch("Weighted", { pack_type: "carton" });
    await call("rd_engineer", "POST", `/api/launches/${l.body.id}/recommend`);
    const rec = (await call("rd_engineer", "GET", `/api/launches/${l.body.id}`)).body.recommendations[0];
    expect(rec.weights.normalised.attributes.pack_type).toBeGreaterThan(0.2);
    expect(rec.flags.some((x: any) => /pack_type|Pack type is not used/.test(x.message))).toBe(false);
  });

  it("a sparse field is left out of matching and the recommendation says so", async () => {
    const r = await call("category_owner", "POST", `/api/categories/${cat}/fields`, { code: "brix", name: "Brix", type: "numeric", absMin: 0, absMax: 30, initialWeight: 5 });
    F.brix = r.body.id;
    await call("category_owner", "PATCH", `/api/categories/${cat}/fields/${F.brix}`, { action: "activate" });
    const f = await find("brix");
    expect(f.coverage).toBe(0);
    expect(f.usedForMatching).toBe(false);
    const l = await newLaunch("Sparse", { brix: 12 });
    await call("rd_engineer", "POST", `/api/launches/${l.body.id}/recommend`);
    const rec = (await call("rd_engineer", "GET", `/api/launches/${l.body.id}`)).body.recommendations[0];
    expect(rec.flags.some((x: any) => x.type === "missing_data" && /Brix is not used for matching yet/.test(x.message))).toBe(true);
    expect(rec.weights.normalised.attributes.brix).toBeUndefined();
  });

  it("text and date fields are information only; text is hidden from AI by default", async () => {
    const r = await call("category_owner", "POST", `/api/categories/${cat}/fields`, { code: "remarks", name: "Remarks", type: "text", kind: "matching" });
    F.remarks = r.body.id;
    const f = await find("remarks");
    expect(f.kind).toBe("info");
    expect(f.aiVisible).toBe(false);
    await call("category_owner", "PATCH", `/api/categories/${cat}/fields/${F.remarks}`, { action: "activate" });
    expect((await newLaunch("Long text", { remarks: "x".repeat(501) })).body.message).toMatch(/longer than 500/);
    const ok = await newLaunch("With remarks", { remarks: "Supplier changed stabiliser" });
    expect((await call("rd_engineer", "GET", `/api/launches/${ok.body.id}`)).body.attrs.remarks).toBe("Supplier changed stabiliser");
  });

  it("editing is restricted once products hold values", async () => {
    const patch = (p: unknown) => call("category_owner", "PATCH", `/api/categories/${cat}/fields/${F.pack}`, { action: "update", patch: p });
    expect((await patch({ choices: ["carton"] })).status).toBe(422);
    expect((await patch({ choices: ["carton", "pouch", "can"] })).status).toBe(200);
    expect((await patch({ helpText: "How the drink is packed" })).status).toBe(200);
    expect((await patch({ unit: "x" })).status).toBe(422);
    const b = F.brix;
    // an earlier test already stored a Brix value, so the range can only be widened
    expect((await call("category_owner", "PATCH", `/api/categories/${cat}/fields/${b}`, { action: "update", patch: { absMin: 5 } })).status).toBe(422); // narrowing
    expect((await call("category_owner", "PATCH", `/api/categories/${cat}/fields/${b}`, { action: "update", patch: { absMax: 20 } })).status).toBe(422); // narrowing
    expect((await call("category_owner", "PATCH", `/api/categories/${cat}/fields/${b}`, { action: "update", patch: { absMax: 40 } })).status).toBe(200); // widening
  });

  it("fields are retired with a reason, never deleted", async () => {
    for (const k of ["pack", "brix", "remarks"]) {
      expect((await call("category_owner", "PATCH", `/api/categories/${cat}/fields/${F[k]}`, { action: "retire" })).status).toBe(422);
      expect((await call("category_owner", "PATCH", `/api/categories/${cat}/fields/${F[k]}`, { action: "retire", reason: "Test cleanup" })).status).toBe(200);
    }
    expect((await find("pack_type")).status).toBe("Retired");
    const cfg = (await call("rd_engineer", "GET", `/api/categories/${cat}/config`)).body;
    expect(cfg.attrDefs.some((a: any) => ["pack_type", "brix", "remarks"].includes(a.code))).toBe(false);
    expect((await newLaunch("After retire", {})).status).toBe(200); // forms keep working
  });

  it("changes are audited", async () => {
    const a = (await call("category_owner", "GET", "/api/audit?limit=500")).body.events;
    expect(a.some((e: any) => e.entity === "cfg.attribute_def")).toBe(true);
    expect(a.some((e: any) => e.entity === "core.product_attribute_value" && e.reason === "Product field back-fill")).toBe(true);
  });
});

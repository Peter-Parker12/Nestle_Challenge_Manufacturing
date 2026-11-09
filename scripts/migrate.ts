import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

// Minimal forward-only migration runner. Applied files are tracked in public.schema_migrations.
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const dir = join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const done = await c.query("select 1 from public.schema_migrations where name=$1", [f]);
    if (done.rowCount) continue;
    console.log(`[migrate] applying ${f}`);
    await c.query("begin");
    try {
      await c.query(readFileSync(join(dir, f), "utf8"));
      await c.query("insert into public.schema_migrations(name) values ($1)", [f]);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  }
  console.log("[migrate] up to date");
  await c.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

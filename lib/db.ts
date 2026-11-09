import { Pool, PoolClient, QueryResultRow, types } from "pg";

// Return DATE columns as "YYYY-MM-DD" strings. The default converts them to a local-time Date, which shifts the day in some time zones.
types.setTypeParser(1082, (v: string) => v);

const g = globalThis as unknown as { __baf1Pool?: Pool };

export function pool(): Pool {
  if (!g.__baf1Pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__baf1Pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  }
  return g.__baf1Pool;
}

export type Ctx = { userId?: string | null; reason?: string | null; adminOverride?: boolean };

/** Run fn in a transaction. The user id / reason are exposed to audit triggers via session settings. */
export async function tx<T>(ctx: Ctx, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.reason', $2, true), set_config('app.admin_override', $3, true)", [
      ctx.userId ?? "",
      ctx.reason ?? "",
      ctx.adminOverride ? "on" : "off",
    ]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function q<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool().query<T>(text, params as any[]);
  return r.rows;
}

export async function q1<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function qc<T extends QueryResultRow = any>(c: PoolClient, text: string, params: unknown[] = []): Promise<T[]> {
  const r = await c.query<T>(text, params as any[]);
  return r.rows;
}

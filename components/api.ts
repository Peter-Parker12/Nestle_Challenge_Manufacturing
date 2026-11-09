export type ApiResult<T = any> = { ok: boolean; status: number; data: T; message?: string; error?: string };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
      headers: opts.form ? undefined : { "content-type": "application/json" },
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, message: res.ok ? undefined : data?.message ?? `Request failed (${res.status})`, error: data?.error };
  } catch {
    return { ok: false, status: 0, data: null as T, message: "Could not reach the server" };
  }
}

export const badge = (v?: string | null) =>
  ({ Pass: "b-green", Accepted: "b-green", Low: "b-green", High: "b-red", Fail: "b-red", Rejected: "b-red", Cancelled: "b-gray", Marginal: "b-amber", Medium: "b-amber", "Accepted with conditions": "b-amber", Closed: "b-blue" } as Record<string, string>)[v ?? ""] ?? "b-gray";

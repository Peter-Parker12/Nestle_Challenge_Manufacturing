import { q, q1 } from "./db";
import { fillerHealth, listFillers } from "./linehealth";
import { listLaunches } from "./repo";
import { riskBoard } from "./risk";

/**
 * The plant, line by line: one status per line that joins the three modules.
 * It only reads. "Attention" means a person should look; it never blocks a launch or changes anything.
 */
export type LineState = "Attention" | "Watch" | "OK";
export type LineStatus = {
  code: string; name: string; state: LineState; reasons: string[];
  seals: { high: number; medium: number; highWithoutStop: number; openAlerts: number; worst: { positionId: string; label: string; score: number } | null };
  filler: { id: string; station: string; stationCode: string; level: string; score: number; prediction: string } | null;
  nextStop: { start_on: string; end_on: string; kind: string } | null;
  launches: { id: string; code: string; product: string; status: string }[];
};

const OPEN_LAUNCH = (s: string) => !["Closed", "Cancelled"].includes(s);

export async function plantStatus(): Promise<{ lines: LineStatus[]; asOf: string }> {
  const risk = await riskBoard();
  const lines = await q<{ id: string; code: string; name: string }>(`select id, code, name from cfg.line order by code`);
  const fillers = await listFillers();
  const launches = ((await listLaunches()) as any[]).filter((l) => OPEN_LAUNCH(l.status));
  const planned = new Set(risk.alerts.filter((a: any) => a.state === "Planned").map((a: any) => a.position_id));
  const out: LineStatus[] = [];
  for (const ln of lines) {
    const ranked = risk.ranked.filter((r) => r.lineCode === ln.code);
    const high = ranked.filter((r) => r.result.level === "High");
    const medium = ranked.filter((r) => r.result.level === "Medium");
    const worst = ranked[0];
    const f = fillers.find((x) => x.line_code === ln.code);
    let filler: LineStatus["filler"] = null;
    if (f) {
      const h = await fillerHealth(f.id);
      const s = h.stations[0];
      if (s) filler = { id: f.id, station: s.name, stationCode: s.code, level: s.level, score: s.score, prediction: s.prediction.text };
    }
    const stop = (risk.stops[ln.code] ?? [])[0] ?? null;
    const highWithoutStop = high.filter((r) => !planned.has(r.positionId)).length;
    const reasons: string[] = [];
    if (filler?.level === "High") reasons.push(`Filler: ${filler.station} needs attention (score ${filler.score})`);
    if (high.length) reasons.push(`${high.length} seal${high.length > 1 ? "s" : ""} at High risk${highWithoutStop ? `, ${highWithoutStop} without a planned stop` : ""}`);
    if (filler?.level === "Medium") reasons.push(`Filler: ${filler.station} is rising (score ${filler.score})`);
    if (medium.length && !high.length) reasons.push(`${medium.length} seal${medium.length > 1 ? "s" : ""} at Medium risk`);
    const state: LineState = filler?.level === "High" || high.length ? "Attention" : filler?.level === "Medium" || medium.length ? "Watch" : "OK";
    out.push({
      code: ln.code, name: ln.name, state, reasons,
      seals: {
        high: high.length, medium: medium.length, highWithoutStop,
        openAlerts: risk.alerts.filter((a: any) => a.line_code === ln.code && ["New", "Acknowledged", "Planned", "Deferred"].includes(a.state)).length,
        worst: worst && worst.result.level !== "Low" ? { positionId: worst.positionId, label: `${worst.assembly} · ${worst.positionName}`, score: worst.result.score } : null,
      },
      filler, nextStop: stop ? { start_on: String(stop.start_on).slice(0, 10), end_on: String(stop.end_on).slice(0, 10), kind: stop.kind } : null,
      launches: launches.filter((l) => l.line === ln.code).map((l) => ({ id: l.id, code: l.code, product: l.product, status: l.status })),
    });
  }
  return { lines: out, asOf: new Date().toISOString().slice(0, 10) };
}

/** What a person planning a trial on this launch's line should know first. Advice is plain text built from the status above. */
export async function launchLineContext(launchId: string) {
  const l = await q1<{ line_code: string; status: string; code: string }>(
    `select ln.code as line_code, l.status, l.code from core.launch_project l join cfg.line ln on ln.id = l.line_id where l.id = $1`, [launchId]);
  if (!l) return null;
  const { lines } = await plantStatus();
  const s = lines.find((x) => x.code === l.line_code);
  if (!s) return null;
  const today = Date.now();
  const soon = s.nextStop && Date.parse(s.nextStop.start_on + "T00:00:00Z") - today < 21 * 86400000 ? s.nextStop : null;
  const advice: string[] = [];
  if (s.filler?.level === "High") advice.push(`Check the filler first (${s.filler.station}); a trial on a machine that is about to stop wastes product and muddies the results.`);
  if (s.seals.highWithoutStop) advice.push("Seals at High risk have no planned stop. Product-contact seals on this line should be changed in the next stop, before or between trial runs.");
  if (soon) advice.push(`A planned ${soon.kind} stop is ${soon.start_on} to ${soon.end_on}. Plan trial runs around it.`);
  return { launch: l.code, launchStatus: l.status, show: OPEN_LAUNCH(l.status), line: s, soon, advice };
}

import { HttpError } from "./auth";
import { q, q1, tx } from "./db";
import { buildTemplate, csvOf, MAX_BYTES, parseHistory, templateColumns, type ImportConfig, type ImportOptions, type Issue, type ParsedLaunch } from "./importer";
import { loadCategoryConfig } from "./repo";

async function config(categoryId: string): Promise<ImportConfig & { lines: Map<string, string>; name: string }> {
  const cat = await q1("select id, name from cfg.category where id=$1 and active", [categoryId]);
  if (!cat) throw new HttpError(404, "Category not found", "not_found");
  const c = await loadCategoryConfig(categoryId);
  const lines = await q("select id, code from cfg.line order by code");
  const reasons = await q("select code from cfg.reason_code where active");
  const existing = await q("select code from core.product where category_id=$1", [categoryId]);
  return {
    attrDefs: c.attrDefs, paramDefs: c.paramDefs, tests: c.tests,
    lineCodes: new Set(lines.map((l) => l.code)), reasonCodes: new Set(reasons.map((r) => r.code)), existingProductCodes: new Set(existing.map((e) => e.code)),
    lines: new Map(lines.map((l) => [l.code, l.id])), name: cat.name,
  };
}

export async function templateFor(categoryId: string) {
  const cfg = await config(categoryId);
  return { csv: buildTemplate(cfg, [...cfg.lineCodes][0] ?? "L1"), name: cfg.name };
}

const summarise = (launches: ParsedLaunch[], issues: Issue[], rows: number) => ({
  rows,
  launches: launches.length,
  runs: launches.reduce((a, l) => a + l.runs.length, 0),
  validLaunches: launches.filter((l) => l.valid).length,
  invalidLaunches: launches.filter((l) => !l.valid).length,
  accepted: launches.filter((l) => l.valid && l.taDecision && l.taDecision !== "Rejected").length,
  errors: issues.filter((i) => i.level === "error"),
  warnings: issues.filter((i) => i.level === "warning"),
  preview: launches.slice(0, 8).map((l) => ({
    ref: l.ref, product: l.productName, line: l.lineCode, runs: l.runs.length, results: l.runs.map((r) => r.result),
    outcome: l.status === "Cancelled" ? "Cancelled (no acceptance)" : l.taDecision, valid: l.valid,
  })),
});

/** Step 1: read the file, store the raw rows in staging, report problems. Nothing reaches the operational tables. */
export async function validateUpload(userId: string, input: { filename: string; text: string; categoryId: string; assumeAccepted: boolean }) {
  if (input.text.length > MAX_BYTES) throw new HttpError(413, "File is larger than 5 MB", "too_large");
  const cfg = await config(input.categoryId);
  const opt: ImportOptions = { assumeAccepted: input.assumeAccepted };
  const parsed = parseHistory(input.text, cfg, opt);
  const sum = summarise(parsed.launches, parsed.issues, parsed.rows);

  const errRows = new Map<number, string>();
  parsed.issues.filter((i) => i.level === "error" && i.row).forEach((i) => errRows.set(i.row!, [errRows.get(i.row!), i.message].filter(Boolean).join("; ")));

  const loadId = await tx({ userId, reason: "Historical import: file checked" }, async (c) => {
    const load = (await c.query(
      "insert into stg.load(source_system, source_ref, loaded_by, status, row_count) values ('csv-upload', $1, $2, $3, $4) returning id",
      [JSON.stringify({ filename: input.filename, categoryId: input.categoryId, assumeAccepted: input.assumeAccepted }), userId,
        sum.errors.length ? "Has errors" : "Validated", parsed.rows])).rows[0].id as string;
    for (let i = 0; i < parsed.rawRows.length; i++)
      await c.query("insert into stg.raw_row(load_id,row_no,payload,error) values ($1,$2,$3,$4)", [load, i + 2, JSON.stringify(parsed.rawRows[i]), errRows.get(i + 2) ?? null]);
    return load;
  });
  return { loadId, filename: input.filename, category: cfg.name, ...sum };
}

/** Step 2: re-read the stored rows (not what the browser sends), validate again, and write launch by launch. */
export async function commitLoad(userId: string, loadId: string, opts: { skipInvalid: boolean }) {
  const load = await q1("select * from stg.load where id=$1", [loadId]);
  if (!load) throw new HttpError(404, "Import not found", "not_found");
  if (load.status === "Imported" || load.status === "Partially imported") throw new HttpError(409, `This file was already imported (${load.status})`, "conflict");
  const meta = JSON.parse(load.source_ref) as { filename: string; categoryId: string; assumeAccepted: boolean };
  const cfg = await config(meta.categoryId);
  const stored = await q("select row_no, payload from stg.raw_row where load_id=$1 order by row_no", [loadId]);
  if (!stored.length) throw new HttpError(409, "The stored file is empty", "conflict");
  const header = Object.keys(stored[0].payload);
  const parsed = parseHistory(csvOf(header, stored.map((s) => s.payload)), cfg, { assumeAccepted: meta.assumeAccepted });
  const errors = parsed.issues.filter((i) => i.level === "error");
  if (errors.length && !opts.skipInvalid)
    throw new HttpError(409, `The file still has ${errors.length} error(s). Fix them and check the file again, or choose to skip the launches with errors.`, "has_errors");

  const toImport = parsed.launches.filter((l) => l.valid);
  if (!toImport.length) throw new HttpError(409, "There are no valid launches to import", "nothing_to_import");

  const paramId = new Map(cfg.paramDefs.map((p) => [p.code, p.id]));
  const attrId = new Map(cfg.attrDefs.map((a) => [a.code, a.id]));
  const testId = new Map(cfg.tests.map((t) => [t.code, (t as any).id as string]));
  const imported: { ref: string; launch: string }[] = [];
  const failed: { ref: string; message: string }[] = [];

  for (const l of toImport) {
    try {
      const code = await tx({ userId, reason: `Historical import ${loadId.slice(0, 8)}` }, async (c) => {
        const p = (await c.query("insert into core.product(category_id,code,name,external_ref) values ($1,$2,$3,$4) returning id", [meta.categoryId, l.ref, l.productName, `import:${loadId}`])).rows[0];
        for (const [k, v] of Object.entries(l.attrs)) {
          const def = cfg.attrDefs.find((a) => a.code === k)!;
          await c.query("insert into core.product_attribute_value(product_id,attribute_def_id,value_num,value_choice) values ($1,$2,$3,$4)", [p.id, attrId.get(k), def.type === "numeric" ? v : null, def.type === "choice" ? v : null]);
        }
        for (const [k, s] of Object.entries(l.specs)) await c.query("insert into core.product_spec values ($1,$2,$3,$4)", [p.id, testId.get(k), s.min, s.max]);
        const launch = (await c.query(
          "insert into core.launch_project(product_id,line_id,objective,status,created_by,created_at) values ($1,$2,$3,'Draft',$4,$5) returning id, code",
          [p.id, cfg.lines.get(l.lineCode), `Imported historical launch (file ${meta.filename})`, userId, `${l.createdDate}T09:00:00Z`])).rows[0];
        for (const [i, r] of l.runs.entries()) {
          const lastRun = i === l.runs.length - 1;
          const run = (await c.query(
            `insert into core.trial_run(launch_id,run_no,started_at,ended_at,status,result,result_notes,loss_kg,next_step,notes)
             values ($1,$2,$3,$3,'Closed',$4,$5,$6,$7,$8) returning id`,
            [launch.id, r.runNo, `${r.date}T09:00:00Z`, r.result, JSON.stringify(r.resultNotes), r.lossKg, lastRun ? (r.result === "Pass" ? "TA" : "Stop") : "Repeat", r.notes])).rows[0];
          for (const [k, v] of Object.entries(r.params)) await c.query("insert into core.run_parameter(run_id,parameter_def_id,actual) values ($1,$2,$3)", [run.id, paramId.get(k), v]);
          for (const [k, v] of Object.entries(r.quality)) await c.query("insert into core.run_quality(run_id,quality_test_def_id,value,spec_min,spec_max,pass) values ($1,$2,$3,$4,$5,true)", [run.id, testId.get(k), v, l.specs[k]?.min ?? null, l.specs[k]?.max ?? null]);
          for (const rc of r.reasons) await c.query("insert into core.run_reason(run_id,reason_code) values ($1,$2)", [run.id, rc]);
        }
        // Close last: a closed launch is read-only.
        await c.query(
          "update core.launch_project set status=$2, ta_decision=$3, ta_date=$4, closed_at=$5, cancel_reason=$6 where id=$1",
          [launch.id, l.status, l.taDecision, l.status === "Closed" ? l.taDate : null, `${l.taDate ?? l.createdDate}T12:00:00Z`, l.cancelReason]);
        return launch.code as string;
      });
      imported.push({ ref: l.ref, launch: code });
    } catch (e: any) {
      failed.push({ ref: l.ref, message: e?.message ?? "Failed" });
    }
  }

  const okRefs = new Set(imported.map((i) => i.ref));
  const rowsDone = parsed.launches.filter((l) => okRefs.has(l.ref)).flatMap((l) => l.rows);
  const skipped = parsed.launches.length - imported.length;
  await q("update stg.raw_row set mapped=true where load_id=$1 and row_no = any($2::int[])", [loadId, rowsDone]);
  await q("update stg.load set status=$2 where id=$1", [loadId, skipped ? "Partially imported" : "Imported"]);
  return { imported: imported.length, skipped, importedLaunches: imported, failed, skippedWithErrors: parsed.launches.filter((l) => !l.valid).map((l) => l.ref) };
}

export async function listLoads() {
  return q(
    `select l.id, l.loaded_at, l.status, l.row_count, l.source_ref, u.name as loaded_by,
       (select count(*)::int from stg.raw_row r where r.load_id=l.id and r.mapped) as rows_imported,
       (select count(*)::int from stg.raw_row r where r.load_id=l.id and r.error is not null) as rows_with_errors
     from stg.load l left join cfg.app_user u on u.id=l.loaded_by order by l.loaded_at desc limit 30`);
}

export { templateColumns };

/** Export closed and cancelled launches in the same format the importer reads (also useful as a backup). */
export async function exportHistory(categoryId: string): Promise<string> {
  const cfg = await config(categoryId);
  const cols = templateColumns(cfg);
  const launches = await q(
    `select l.id, l.status, l.created_at, l.ta_decision, l.ta_date, p.id as pid, p.code, p.name, ln.code as line
     from core.launch_project l join core.product p on p.id=l.product_id join cfg.line ln on ln.id=l.line_id
     where p.category_id=$1 and l.status in ('Closed','Cancelled') order by l.created_at, l.code`, [categoryId]);
  const rows: Record<string, string | number | null>[] = [];
  for (const l of launches) {
    const attrs = await q("select a.code, v.value_num, v.value_choice from core.product_attribute_value v join cfg.attribute_def a on a.id=v.attribute_def_id where v.product_id=$1", [l.pid]);
    const specs = await q("select t.code, s.spec_min, s.spec_max from core.product_spec s join cfg.quality_test_def t on t.id=s.quality_test_def_id where s.product_id=$1", [l.pid]);
    const runs = await q("select * from core.trial_run where launch_id=$1 order by run_no", [l.id]);
    for (const [i, r] of runs.entries()) {
      const params = await q("select p.code, rp.actual from core.run_parameter rp join cfg.parameter_def p on p.id=rp.parameter_def_id where rp.run_id=$1", [r.id]);
      const qual = await q("select t.code, rq.value from core.run_quality rq join cfg.quality_test_def t on t.id=rq.quality_test_def_id where rq.run_id=$1", [r.id]);
      const reasons = await q("select reason_code from core.run_reason where run_id=$1 order by reason_code", [r.id]);
      const row: Record<string, string | number | null> = {
        launch_ref: l.code, product_name: l.name, line: l.line, created_date: new Date(l.created_at).toISOString().slice(0, 10), run_no: r.run_no,
        run_date: r.started_at ? new Date(r.started_at).toISOString().slice(0, 10) : "", result: r.result, loss_kg: r.loss_kg, reason_codes: reasons.map((x) => x.reason_code).join(";"), notes: r.notes ?? "",
        ta_decision: i === runs.length - 1 ? l.ta_decision ?? "" : "", ta_date: i === runs.length - 1 && l.ta_date ? new Date(l.ta_date).toISOString().slice(0, 10) : "",
      };
      if (i === 0) {
        for (const a of attrs) row[`attr_${a.code}`] = a.value_num !== null ? Number(a.value_num) : a.value_choice;
        for (const s of specs) { row[`spec_${s.code}_min`] = s.spec_min !== null ? Number(s.spec_min) : ""; row[`spec_${s.code}_max`] = s.spec_max !== null ? Number(s.spec_max) : ""; }
      }
      for (const p of params) if (p.actual !== null) row[`param_${p.code}`] = Number(p.actual);
      for (const x of qual) row[`q_${x.code}`] = Number(x.value);
      rows.push(row);
    }
  }
  const { toCsv } = await import("./csv");
  return toCsv([cols, ...rows.map((r) => cols.map((c) => r[c] ?? ""))]);
}

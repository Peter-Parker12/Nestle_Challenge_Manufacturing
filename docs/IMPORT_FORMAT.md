# Importing historical data

The **Import history** page loads previous launches and trial runs as the starting database. The recommendations learn from the accepted launches in it.

## Starting from an empty database

A new deployment needs the reference setup first (users, lines, categories, parameters, quality tests, reason codes, expert rules), then your history.

| Step | How |
|---|---|
| 1. Load the reference setup only | Set `SEED_MODE=config` in `.env` before the first start. Locally: `npx tsx scripts/seed.ts --force --config-only` |
| 2. Replace the sample parameters, lines and limits with Nestlé's | The reference setup describes a sample UHT drinks category and a sample sauces category. Real definitions are changed in `scripts/seed.ts` or with SQL on the `cfg` tables. There is no admin screen for this yet (see `PRODUCTION_GAPS.md`). |
| 3. Open **Import history**, download the template for the category, fill it in | See below |
| 4. Check the file, fix problems, import | Nothing is saved until you confirm |

`SEED_MODE=demo` instead loads the synthetic history and a demo launch, for presenting.

## The file

CSV (UTF-8). Excel users: Save As, CSV UTF-8. Maximum 5 MB and 5,000 rows. **One row is one trial run.** Rows with the same `launch_ref` form one launch.

The columns are generated for each category, so download the template for the category you are loading. For the sample UHT category it looks like this:

| Column | Required | Meaning |
|---|---|---|
| `launch_ref` | yes | Your id for the launch. It becomes the product code and must not already exist in the category, which is what stops a file being imported twice |
| `product_name` | yes | |
| `line` | yes | A line code that exists (for example `L1`) |
| `created_date` | no | `YYYY-MM-DD`. Defaults to the first run date |
| `run_no` | yes | 1, 2, 3 within a launch, no gaps |
| `run_date` | no | `YYYY-MM-DD` |
| `result` | see below | Pass, Marginal or Fail |
| `loss_kg` | no | Material lost in this run |
| `reason_codes` | see below | Separated by `;`. Must be codes that exist |
| `notes` | no | |
| `ta_decision` | last run | Accepted, Accepted with conditions or Rejected |
| `ta_date` | no | `YYYY-MM-DD`. Defaults to the last run date |
| `attr_<code>` | first row of each launch | One column per product attribute (fat, solids, viscosity, base…). Required ones must be filled |
| `param_<code>` | per run | The setting actually used in that run |
| `q_<code>` | per run | Quality test result |
| `spec_<code>_min`, `spec_<code>_max` | first row of each launch | Quality target for the product |

Empty cells are fine for anything unknown, except the required ones. Decimal commas inside quotes (`"30,5"`) are accepted.

## Rules applied to the file

| Rule | Behaviour |
|---|---|
| Run result | If a run has quality results and specs, the result is **calculated** by the same rules as live runs. If the file gives a different result: a **worse** file result is kept (history can contain causes the columns do not show, for example equipment or line capability), a better one is replaced by the calculated result. Both cases give a warning. With no quality data the file's `result` is used and must be present. |
| Failed or marginal run followed by another run | Needs at least one reason code (the same rule as live data, BR-14) |
| Last run passed, no `ta_decision` | Error, or treated as **Accepted** with a warning if you tick the option on the page |
| Last run did not pass, no `ta_decision` | Launch is imported as **Cancelled** and kept for the rework statistics |
| Last run did not pass but `ta_decision` is Accepted | Error |
| Only **Accepted** launches (and accepted with conditions) are used as evidence for recommendations | Rejected and cancelled launches are stored but not matched against |
| Limits and ranges | Attributes and settings must be inside the ranges defined for the category. Line capability is **not** checked for history, because limits may have changed since |
| Duplicates | A `launch_ref` that already exists in the category is an error |
| Product data repeated on later rows | The first row is used. Differences give a warning |

## What happens when you import

1. **Check the file.** The rows are stored in the staging table (`stg.load`, `stg.raw_row`) with the error for each bad row. Nothing reaches the operational tables. You see the number of launches and runs, every problem with its row number (header is row 1), warnings, and a preview.
2. **Fix and re-check, or skip.** Launches with errors can be skipped; the others are imported.
3. **Import.** The server re-reads the **stored** rows (not what the browser sends), validates again, and writes one launch at a time in its own transaction, in the order the database rules require (runs in sequence, reasons before the next run, launch closed last). A launch that fails does not stop the others.
4. Imported launches are marked in the audit log with the user and the import id. The file name and status stay in **Previous imports**.

## Export

**Export current history** downloads the closed and cancelled launches of the category in this same format. Use it as a backup, to move data between environments, or to correct and re-load data. Exporting, wiping and re-importing gives a byte-identical export (tested on 60 launches). Access is limited to the import roles because recipes are commercially sensitive.

## Roles

Plant admin, category owner and process engineer can import and export.

## Limits

- CSV only. There is no direct Excel, PDF or Word import. (Reading old PDF or Word trial reports with Claude is available one run at a time on the launch page; see `AI_DESIGN.md`.)
- Everything in a file must belong to one category.
- Deleting or correcting imported launches is not possible through the app; closed launches are read-only by design. A wrong load must be corrected by an administrator with SQL, and the audit log records the original.
- New parameters, attributes, lines or reason codes in your data must be added to the configuration before the file can be imported.

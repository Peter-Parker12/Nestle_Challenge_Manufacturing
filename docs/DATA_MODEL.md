# Data model

PostgreSQL 16. The authoritative definition is `db/migrations/001_init.sql`. This document explains it.

## Hierarchy

```
Product (SKU)  ──<  Launch project  ──<  Trial run  ──<  readings, quality results, reasons
   │                    │
   └ attribute values   └──<  Recommendation ──< lines, evidence, risk flags, decision
```

- **Product**: what is being launched. Long-lived master data with attribute values and quality specs.
- **Launch project**: one attempt to bring a product to stable production on a line. Has a status, the technical acceptance decision, and the recommendations.
- **Trial run**: one test production run inside a launch project, numbered 1, 2, 3. A run is its own record, not a field on the product, because it carries many readings and results.

## Schemas

| Schema | Holds |
|---|---|
| `cfg` | Users, categories, process steps, parameter definitions, attribute definitions, quality test definitions, reason codes, lines, line capability, expert rules |
| `core` | Products, attribute values, specs, recipes, launch projects, trial runs, run parameters, run quality, run reasons, run materials |
| `rec` | Weight sets and items, recommendations, lines, evidence, risk flags, decisions |
| `ai` | Documents, extractions, Claude call log, rule suggestions |
| `stg` | Raw rows of every uploaded history file with the error for each bad row, and the status of each load. Used by the Import history page |
| `audit` | Append-only event log |

## Key tables

### Configuration (`cfg`)

| Table | Notes |
|---|---|
| `category` | Product category, for example `UHT_DRINK`. Has an owner. |
| `process_step`, `parameter_def` | Parameters have unit, absolute min and max, `is_critical`, `is_locked` (locked limits are never weighted down), and a version. |
| `attribute_def` | A product field. Type (number, choice, yes/no, text, date), `kind` (matching or info), required flag, allowed range or options, help text, section, order, `status` (Draft, Active, Retired), `ai_visible`. Drives forms, validation, imports and similarity. Never deleted. See `CUSTOM_FIELDS.md` |
| `quality_test_def` | Tests with a critical flag (critical tests decide run failure), status (Active or Retired) and help text. Never deleted |
| `line_capability` | Per line and parameter, the range the line can run, inside the parameter's allowed range. Windows are clipped to this. Audited |
| `sme_rule` | Condition as JSON (`{"attr":"fat_pct","op":">","value":2.5}`), severity, message, status, approver. |
| `reason_code` | Fixed list of failure reasons. |

### Operational (`core`)

| Table | Key columns and rules |
|---|---|
| `product_attribute_value` | One row per product and field, in the typed column that matches the field: `value_num`, `value_choice`, `value_text` (max 500), `value_date`, `value_bool`. Audited |
| `product_spec` | Spec min and max per quality test, per product. |
| `launch_project` | `code` (L-1000…), `status`, `ta_decision`, `ta_date`, `closed_at`. |
| `trial_run` | `run_no` unique per launch. `status`, `result`, `result_notes`, override fields, `loss_kg`, `next_step`, `plan_rec_id` (the recommendation followed). A check constraint requires a reason when the result is overridden. |
| `run_parameter` | `planned` and `actual` in one row, so deviation is simple arithmetic. |
| `run_quality` | Value, spec snapshot, and `pass`, **computed by trigger**. |
| `run_reason` | Reason codes for Marginal and Fail runs. |

### Recommendations (`rec`)

| Table | Notes |
|---|---|
| `weight_set`, `weight_item` | Levels `platform`, `category`, `recipe`. Weight 0 to 5. Sets are replaced by a new set that `supersedes` the old one. Items are immutable. |
| `recommendation` | Also stores `inputs_snapshot`: the product values, fields used or left out, parameter limits and capability, and thresholds the engine saw. Stores `weights_snapshot` (exact levels, normalised weights, source), `engine_version`, `history_as_of`, `n_matched`, `confidence`, `overall_risk`. |
| `recommendation_line` | Start value and window per parameter, clipped flag and reason. |
| `recommendation_evidence` | Launches used, similarity, rank, whether they passed on the first run. |
| `risk_flag` | Type, severity, message, detail JSON, optional expert rule. |
| `decision` | Approved, edited or rejected, final values, reason, who, when. |

### AI (`ai`)

| Table | Notes |
|---|---|
| `document` | Uploaded file metadata and bytes (demo only; use object storage in production). |
| `extraction` | Claude's proposed run from a report, validation problems, review status, the run it created. Never writes to `core` until a person approves. |
| `call_log` | Every Claude call: purpose, model, prompt hash, ids of the rows given as context, response, validity, tokens, latency, errors. |
| `rule_suggestion` | Candidate rules, rationale, evidence launches, review status. |

### Audit

`audit.event` records insert, update and delete on launches, runs, weight sets, recommendations, decisions, expert rules, extractions and rule suggestions, with the user id and reason taken from the transaction.

## Database-enforced behaviour

| Mechanism | Effect |
|---|---|
| `trg_quality_pass` | `run_quality.pass` is derived from value and spec. |
| `trg_guard_*` | A Closed launch and its runs are read-only unless an audited admin override is set. |
| `trg_new_run` | Run numbers go 1, 2, 3 in order; the previous run needs a result, and a Marginal or Fail run needs a reason code. |
| `block_change` triggers | `recommendation`, `recommendation_line`, `recommendation_evidence`, `decision`, `weight_item`, `audit.event` accept inserts only. |
| Check constraints | Weights 0 to 5, window low not above high, spec min not above max, override needs a reason, capability min not above max. |
| Audit triggers | Fill `audit.event` for business tables. |

## Views

- `core.launch_kpi_v`: one row per launch with run count, loss, first pass, days to acceptance, and whether a recommendation was used. Feeds the dashboard.
- `core.run_summary_v`: run level summary for history queries.

## What the engine reads

For a recommendation the engine needs: category configuration, the target product's attribute values, line capability for the chosen line, active expert rules, the resolved weights, and the **history**: closed launches with accepted technical acceptance, each with its attributes, the settings of its accepted run, number of runs, loss, first-pass flag, and reason codes. `repo.loadHistory` assembles this in four queries.

## What Claude reads

Never raw tables. The server builds a bounded package per feature:

| Feature | Package |
|---|---|
| Parse a request | The text and the category's attribute definitions |
| Explain | One recommendation: product, settings, windows, evidence, flags, weights |
| Ask the history | Results of fixed read-only functions, capped at 10 rows each |
| Extract a report | The document plus the parameter and quality test lists |
| Suggest rules | Aggregated rework rates by attribute band |

## Multi-category support

Parameters, attributes, tests, limits and rules are configuration per category. A second category (`SAUCE`) is seeded with its own parameters and attributes and no history, to show the structure. Similarity is computed within a category. Cross-category matching is not implemented.

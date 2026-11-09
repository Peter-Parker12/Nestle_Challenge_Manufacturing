# Business rules

Each rule, where it is enforced, and the test that proves it. "App" means the API and repository code. "DB" means a trigger or constraint, which holds even for a direct SQL session.

Rule numbers follow the BA specification. Status: **Done**, **Partial**, or **Not built**.

| ID | Rule | Enforced in | Tested by | Status |
|---|---|---|---|---|
| BR-01 | Every recommendation shows the past launches behind it | App: evidence rows stored and returned; UI table | e2e "creates a recommendation with evidence, windows and flags" | Done |
| BR-02 | Recommended and edited values are clipped to or limited by line capability. Locked limits cannot be weighted down | App: engine clips; `decide` rejects edits outside capability | unit "clips values to line capability"; e2e "rejects values outside line capability" | Done |
| BR-03 | Nothing is auto-applied. A person approves every plan | App: a run is only created by the decision endpoint; roles restrict it | e2e "approves the plan and creates run 1"; role checks | Done |
| BR-04 | Fewer than the minimum similar launches means confidence Low, and approval then needs a written reason | App: engine sets confidence; `decide` requires a reason | unit "gives Low confidence…"; e2e "a category with no history gives Low confidence, and approval then needs a reason" | Partial: the reason is required, a second approver is **not** required (open question for Nestlé) |
| BR-05 | Only completed launches with an accepted outcome train the system. Failed runs are kept and tagged | App: `loadHistory` filters on Closed and accepted; reasons kept per run | seed and e2e flow (the new launch joins history only after acceptance) | Done |
| BR-06 | The final plan and result are stored against the recommendation | DB: `decision` stores final values; `trial_run.plan_rec_id` links the run | e2e flow; dashboard "recommendations decided / followed" | Done |
| BR-07 | Weight changes need a reason and are logged. Category defaults change only by the category owner | App: reason required, role check; DB: audit trigger on `weight_set` | e2e "requires a reason to change weights", "only the category owner changes category defaults" | Done |
| BR-08 | Warn when more than two items are Critical or the weights shrink the match pool below the minimum | App: `weightWarnings`, shown in the weights panel and the preview | unit "warns on too many Critical items…" | Done |
| BR-09 | Each recommendation records the weights, engine version and data cutoff so it can be reproduced | DB: columns on `recommendation`, immutable | unit "is deterministic"; e2e stores snapshot | Done |
| BR-10 | Cross-category matching only on shared dimensions, labelled lower confidence | – | – | **Not built.** Matching is within one category only |
| BR-11 | Show the result with default weights next to the result with the engineer's weights | App: `/compare` previews both without saving | e2e "compares default weights with the engineer's weights"; unit "changes the neighbours when an engineer reweights" | Done |
| BR-12 | A run belongs to one launch and is numbered in order | DB: unique `(launch_id, run_no)`, trigger `guard_new_run` | direct SQL test (run 3 before run 1 refused); e2e | Done |
| BR-13 | Run result is calculated from quality results. An override needs a reason | App: `deriveRunResult`; DB: `pass` computed by trigger, check constraint on override reason | unit "run outcome" (6 cases); e2e "derives a Fail…", override without reason refused | Done |
| BR-14 | A Marginal or Fail run needs at least one reason code before the run is closed and before the next run | App: `reviewRun`; DB: `guard_new_run` | e2e "needs a reason code…"; direct SQL test | Done |
| BR-15 | A closed launch is read-only | DB: `guard_closed_launch` triggers; App: status checks | direct SQL test (edit and add run refused); e2e "makes a closed launch read-only" | Done |
| BR-16 | The learning data is runs, so a launch with three runs contributes three records with outcomes | DB: runs stored individually with results and reasons; history uses the accepted run and counts reworks | seed; engine "rework history" test | Done |

## Rules not in the original list but implemented

| Rule | Enforced in |
|---|---|
| Only Pass runs can be sent for Technical Acceptance | App `reviewRun` |
| Only QA records Technical Acceptance; a rejected or non-passing latest run cannot be accepted | App `recordTA`, role check |
| A recommendation can be decided only once | App `decide` |
| Recommendations, evidence, decisions, weight items and audit events are append-only | DB `block_change` triggers |
| Importing a report never writes data until a person approves, and then goes through the normal results path so all rules apply | App `approveExtraction` |
| AI output must pass schema validation; cited launch codes must exist in what the model was given; numbers not in the data are flagged | App `lib/ai` |

## Product field rules

| Rule | Enforced in | Tested by |
|---|---|---|
| Only the category owner adds, edits, activates or retires fields | App `requireRole("manageFields")` | e2e "only the category owner defines fields" |
| Fields are retired, never deleted | DB trigger | direct SQL test |
| Code and type are fixed once products have values | DB trigger | direct SQL test |
| Text and date fields cannot affect matching | DB check constraint, app | direct SQL test; unit |
| New matching fields start at weight 0 | App | e2e "starts as a Draft with weight 0" |
| A matching field takes part only when at least 30% of history has a value | Engine | unit "ignores a matching field that too little of the history has"; e2e "a sparse field is left out" |
| A missing value never makes a launch look closer; coverage lowers similarity and confidence | Engine | unit "missing values never make a launch look closer" |
| Choice options can only grow, ranges only widen, units are fixed once values exist | App | e2e "editing is restricted once products hold values" |
| Back-fill writes only filled cells, all or nothing, never touches run data, and is audited | App `backfill`, DB audit trigger | e2e "back-fills values for existing launches" |
| Fields marked not AI visible are never sent to Claude | App `lib/ai/features.ts` | manual check with the recording mock (see `TEST_PLAN.md`): the private value and name appeared in no explanation or history request |

## Process setup rules

| Rule | Enforced in | Tested by |
|---|---|---|
| Only category owners and plant admins change parameters, tests and line capability | App `requireRole("manageProcess")` | e2e "is changed only by category owners and plant admins" |
| Parameters and tests are retired with a reason, never deleted | App, DB trigger | e2e "retires a parameter and a test…"; direct SQL test |
| Code and unit are fixed once runs or results reference them | DB trigger | direct SQL test |
| A parameter code is unique across the category | App | e2e "adds a parameter, validates it…" |
| Ranges can only be widened once runs have values; capability stays inside the range | App, DB check | e2e "limits can be widened but not narrowed…"; "sets line capability inside the allowed range" |
| A parameter with no history is flagged and its window stays inside line capability | Engine | e2e "a parameter with no history is flagged…" |
| A critical quality test out of spec fails the run | Engine | e2e "adds a quality test that decides pass or fail" |

## Import rules

| Rule | Enforced in | Tested by |
|---|---|---|
| A file is checked and stored in staging before anything is written; nothing operational changes until confirmed | App `validateUpload` / `commitLoad` | e2e "imports historical launches from a CSV" |
| The commit re-reads the stored rows, not the browser copy, and validates again | App `commitLoad` | by design; exercised by the same e2e test |
| Each launch is written in its own transaction; a failing launch does not block the others | App | manual test with a broken file |
| A launch reference that already exists is an error, so a file cannot be imported twice | App `parseHistory`; DB unique `(category_id, code)` | unit "a product that already exists"; e2e |
| Run results are calculated; a more severe recorded result is kept | App `parseHistory` | unit "keeps a more severe file result" |
| BR-12 and BR-14 apply to imported runs (sequence, reason before the next run) | App validation and DB triggers | unit "gaps in numbering", "needs a reason code" |
| Only accepted launches become evidence | App `loadHistory` | round-trip test |
| Only plant admin, category owner and process engineer import or export | App `requireRole` | e2e (403 for R&D) |
| Imported launches are audited with the user and import id | DB audit triggers | audit rows with reason "Historical import" |

## Roles

| Role | May |
|---|---|
| R&D engineer | Create launches, recommend, decide on plans, set recipe weights, import reports, cancel |
| Process engineer | Create launches, recommend, decide, start runs, enter results, review runs, set recipe weights, import reports and history, cancel |
| QA | Enter results, review runs, record Technical Acceptance, view the audit log |
| Category owner | Change category default weights, accept or reject suggested expert rules, import and export history, view the audit log |
| Plant admin | Create and cancel launches, import and export history, view the audit log |
| Supply chain, Viewer | Read, and use the history questions |

The permission table is `lib/permissions.ts`. The server checks every action; the browser only hides buttons.

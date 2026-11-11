# Line Intelligence: one platform for BAF-1, BAF-2 and DNF-2

One app, one link (port 9361). Three use cases share one asset model, one calendar, one audit log, one import and one assistant.

| Module | Question | Status |
|---|---|---|
| BAF-1 Launch | What do we start a new product with? | Built |
| BAF-2 Seals and gaskets | Which seals need attention, and when? | Phases 1 and 2 built (record, history, calendar, exposure ledger, explained risk score, alerts, photo inspection) |
| DNF-2 Line health | What is wrong with the filler, what do I do? | Phase 3 built (filler health, stoppage trend, guides, Hey Filler chat) |
| Combined | Lines today, line banner in launches, "Ask the plant", MCP tools | Phase 4 built |

## Phase 1: what exists

**Model** (migration `004_assets.sql`, schema `ast`): Line (`cfg.line`, shared with launches) > Equipment > Position (a place where a seal sits, with criticality 1 to 5) > Part (one physical seal, own passport) > Installation (where and when). Inspections (1 like new to 5 failed), incidents (foreign body, leak, seal failure, contamination risk), planned stops. Read model `ast.v_position`.

**Rules in the database** (BR-A1 to A6): one open seal per position and per part; a seal cannot be fitted before the previous one was removed; inspections must fall inside the seal's time in service and cannot be in the future; installations, inspections and incidents are append-only, closing an installation is the only change allowed; codes never change, nothing is deleted (retire), a position holding a seal cannot be retired; a closed planned stop cannot be changed. All changes are audited with the user.

**Screens**: Overview (one home for all modules), Plant map, Position page (record seal change, inspection, incident), Seal passport (timeline), Seal register, Planned stops, Plant setup, Import seal history (check, then load; export loads back in).

**Roles**: new `maintenance` role (fits seals, inspects, reports incidents, plans stops). QA and process engineers inspect and report. Everyone can read.

**Demo data** (seed): lines L1 and L2, 60 positions, about 165 seals over 12 months, 14 incidents, planned stops. Story position: L1 Filling valve 3 plug seal is past its planned life, rated Damaged, and a fragment was found in a rejected pack. L3 is empty on purpose, so the import template loads there.

## Not yet (honest list)
- No risk score or alerts: the overview lists seals past planned life or rated poor, a plain filter.
- Planned life is a planning figure per seal type, not a prediction.
- Photos, exposure data (runtime, temperature, pressure, CIP), alarms and KPIs come in phases 2 and 3.
- Vietnamese interface not built.

Tests: `tests/assets.int.test.ts` (9, needs a running server, `DATABASE_URL`, fresh seed).

## Phase 2: seal risk (built)

**Exposure ledger** (`ast.exposure`): one row per equipment per week: run hours, CIP cycles, average and maximum temperature and pressure. Aggregates only, loaded by import or an interface later. Seal types carry their ratings (run hours, CIP cycles, temperature, pressure); a missing rating leaves that factor out.

**Risk score** (`lib/engine/seal.ts`, pure, 11 unit tests): nine factors, each 0 to 1 (age, run hours, CIP cycles, weeks above rated temperature, weeks above rated pressure, last inspection, time since inspection, earlier failures at the position, incidents in 12 months). Score = engineers' weights (0 to 5) share × criticality multiplier (0.7 + 0.1 × criticality), capped at 100, then expert floors (F1 rated damaged/failed ≥ 75; F2 foreign body in 30 days and past planned life ≥ 85; F3 beyond 1.5× planned life ≥ 70). Levels: High ≥ 70, Medium ≥ 40. Missing data is listed, never guessed. Every factor, weight and point is shown on the position page.

**Projection**: days until the score first reaches High at the recent (8-week) rate of use, matched to the planned-stop calendar (last window before that date, or the first window if already High, or "plan one earlier").

**Alerts** (`ast.alert`): raised by Refresh when a seal is High or projected High within 45 days. States New, Acknowledged, Planned (needs a stop on the same line), Deferred (needs reason and date), Dismissed (needs reason), Done (only after the seal is replaced; set automatically on refresh). A seal rated damaged or failed, or with a foreign body in the last 30 days, cannot be dismissed (database rule BR-S4). Daily snapshots keep the breakdown behind every score.

**Photo inspection** (`lib/ai/vision.ts`): an inspector attaches a photo; Claude gives an advisory rating and findings, stored server-side and tied to the photo's hash. One-way rule (BR-S5, in the database): the assessment can raise concern, a lower rating needs a written reason. The photo is stored and served back; the AI call log keeps only the hash.

**Backtest**: re-scores every removed seal as the data stood 30 days earlier and compares with a simple age-only rule. On the demo data the failures are synthetic and random, so the result says nothing about the real plant; run it on real history before trusting the weights.

Tests: `tests/seal-engine.test.ts`, `tests/risk.int.test.ts` (needs the mock Claude; see header).
Not yet: photo assessment untested against real Claude (mock only); alerts do not notify anyone (no email or Teams); weights are global, not per equipment.

## Phase 3: line health, "Hey, Filler" (built)

**Data** (migration `006_line_health.sql`, schema `ops`): stations of a filler (each tied to a seal assembly), alarm events, daily KPIs (eUPS, speed, unplanned downtime, defects, material loss), breakdowns, defects, maintenance records (CIL, centerlining, PM03, repair), settings with approved windows (centerline), corrections, troubleshooting guides.

**Health score** (`lib/engine/health.ts`, pure, 7 unit tests): per station 0 to 100 from six factors: alarm rate against usual, alarm trend, unplanned downtime, defects, overdue maintenance, and the BAF-2 risk of the seals in the same assembly. High ≥ 60, Medium ≥ 35. Every factor is shown with its evidence. A station with no tracked seal leaves that factor out.

**Stoppage prediction**: a trend, not a trained model. The warning level is the median number of faults at a station in the 7 days before earlier breakdowns at that filler (needs at least two). If the last 7 days are at or above it, a stop is likely within a week or two; if rising, the weeks until it is reached; otherwise it says so.

**Next actions** per station, by rule: replace a High-risk seal at the next window; plan a check when the fault level is at or above the earlier warning level; do the overdue task; follow the guide for the repeating alarm; return a drifted or out-of-range setting to its target.

**"Auto-correct" is deliberately not automatic.** The system suggests returning a drifted setting to its target. A person changes it on the machine and then records the change; the database refuses a value outside the approved range or a stale starting value (BR-H1). The system never writes to a controller.

**Hey, Filler** (`lib/ai/hey.ts`): chat in English or Vietnamese over read-only tools (health, station detail, guide search). Troubleshooting steps come only from the guides. Answers cite [A:alarm], [G:guide], [P:part]; each citation is checked against what the tools returned and unverifiable ones are flagged on screen. Without `ANTHROPIC_API_KEY` the ranking and actions still work.

**Links between modules**: the filler alarm points at the seal that BAF-2 rates High; the seal page shows the filler alarms for its assembly; replacing the seal lowers the station's score (tested).

**Demo story**: L1 filling valve 3 has six weeks of rising fill-weight and valve alarms, underfill defects, an overdue lubrication task, drifted settings, a worn plug seal rated High, and a breakdown 9 days ago. L2 is calm. L1 valve 6 has a pressure setting outside the approved range.

Tests: `tests/health-engine.test.ts`, `tests/health.int.test.ts` (needs the mock Claude).
Not yet: no import for alarm or PLC data (the demo data is seeded); no real PLC or historian connection (read-only integration is a phase for Nestlé IT/OT); voice input not built; the Vietnamese answers are untested with real Claude; one filler per page, no multi-filler comparison; guides are written by hand, not extracted from manuals.

## Phase 4: the three modules together (built)

**Line status** (`lib/plant.ts`, read-only): one row per line joining the modules. State is Attention (the filler's worst station is High, or any seal is High), Watch (Medium) or OK, with the reasons in plain text: seals at High risk and how many have no planned stop, the filler station needing attention, the next planned stop, the open launches. Shown on the Overview ("Lines today") and on `/plant`. It informs; it never blocks or changes anything.

**Banner in a launch**: an open launch shows the state of its own line above the workflow, with plain advice: check the filler first if a station is High; seals at High risk without a planned stop should be changed in the next stop; a planned stop within 21 days is something to plan trial runs around. Closed and cancelled launches show nothing. The banner does not change the launch, its recommendation or its approval.

**Ask the plant** (`/plant`, `lib/ai/plant.ts`): one chat across launches, seals and the filler, English or Vietnamese. Read-only tools (plant status, seal risk, launch with its line context, filler health, station, guides). Citations are [L:launch], [P:part], [A:alarm], [G:guide] and each one is checked against what the tools returned; unverifiable ones show in red. It cannot approve, schedule, change a setting or close an alert.

**Copilot (MCP)**: four read-only tools added to the original nine, thirteen in all: `get_plant_status`, `get_seal_risk`, `get_filler_health`, `get_launch_line_context`. No tool acknowledges alerts, plans stops, records inspections or corrections; those stay with people in the web app.

Tests: `tests/plant.int.test.ts` (5, needs the mock Claude) and the MCP suite (16, now covers the plant tools and checks that none are writable).
Not yet: real Claude answers untested (mock only); no notifications; the line status is computed on request from current data (no history of line status); one filler per line.

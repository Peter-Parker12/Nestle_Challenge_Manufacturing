# Line Intelligence: one platform for BAF-1, BAF-2 and DNF-2

One app, one link (port 9361). Three use cases share one asset model, one calendar, one audit log, one import and one assistant.

| Module | Question | Status |
|---|---|---|
| BAF-1 Launch | What do we start a new product with? | Built |
| BAF-2 Seals and gaskets | Which seals need attention, and when? | Phase 1 built (record, history, calendar). Phase 2: exposure ledger, explained risk score, alerts, photo inspection |
| DNF-2 Line health | What is wrong with the filler, what do I do? | Phase 3 |
| Combined | Line-health banner in launches, "Ask the plant", MCP tools | Phase 4 |

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
- MCP tools and "Ask the plant" do not cover assets yet (phase 4).
- Vietnamese interface not built.

Tests: `tests/assets.int.test.ts` (9, needs a running server, `DATABASE_URL`, fresh seed).

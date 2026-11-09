# Test plan and results

## What was run

| Level | Command | Count | What it covers |
|---|---|---|---|
| Unit | `npm test` | 60 | Weights scale and layering, similarity, windows, clipping, confidence, every risk flag, expert rules, run outcome rules, AI output checks, CSV parsing and every import validation rule |
| Type check | `npm run typecheck` | – | Whole project, strict mode |
| End to end | `API_BASE=http://localhost:9361 npm run test:int` | 20 | Full launch lifecycle through the HTTP API against a real PostgreSQL: roles, validation, recommendation, weights, decisions, runs, rules BR-02 to BR-15, audit, KPIs, fallback without a key |
| Database rules | manual SQL (below) | 11 | Rules hold when the application is bypassed |
| Claude code paths | mock API (below) | 5 features | Validation, citations, number checks, tool loop, extraction approval |
| Pages | headless browser | 3 screens | Dashboard, launch (empty and with a recommendation) render without errors |
| Build | `npm run build` | – | Production build |

All of the above passed on 9 November 2026.

The end-to-end suite writes to the database. Reseed afterwards: `npx tsx scripts/seed.ts --force`. It needs a freshly seeded database because it uses the open demo launch.

## Import round trip

Export the 60 seeded launches, wipe the database to the reference setup, import the file, export again: the two files are **byte-identical** (17,430 bytes), and the recommendation for the same new product is identical (same windows, start values, similarity scores). A deliberately broken file (unknown line, setting out of range) was refused with the exact rows reported, commit without skipping returned 409, commit with skipping imported 58 and skipped 2, and an R&D user was refused.

This test found and fixed a real bug: `date` columns were converted through the server time zone, shifting acceptance dates by one day on export.

## Database rule checks (run directly in `psql`, bypassing the app)

| Attempt | Result |
|---|---|
| Edit a run of a Closed launch | Refused: "launch is Closed and read-only (BR-15)" |
| Add a run to a Closed launch | Refused |
| Edit or delete the audit log | Refused: append-only |
| Delete a decision | Refused: append-only |
| Edit a recommendation line | Refused: append-only |
| Insert a weight of 9 | Refused: check constraint |
| Add run 3 before run 1 | Refused: BR-12 |
| Override a result without a reason | Refused: check constraint |
| Add run 2 when run 1 failed without a reason code | Refused: BR-14 |
| Rows where stored `pass` disagrees with the spec | 0 |

## Claude paths with the mock API

`tests/mock-claude.mjs` imitates the Messages API and deliberately returns mistakes. Observed:

| Feature | Mock behaviour | Result |
|---|---|---|
| Parse request | Returns pack size 99999, an unknown field, an unmatched fact | Out-of-range value and unknown field dropped with warnings; unmatched fact listed |
| Explain | Includes the number 777 (absent from the data) and the fake citation L-9999 | Both flagged; the second request served from the saved copy with flags kept |
| Ask the history | Tool call, then an answer citing a real and a fake launch | The fake one reported as an invalid citation |
| Extract a report | Valid run | Proposed run shown; approving created run 1 through the normal results path and calculated Pass; approving twice refused |
| Suggest rules | One candidate rule | Stored as Proposed; the R&D role was refused; the category owner accepted and an active rule was created |

Every call appeared in `ai.call_log` with validity and token counts.

## What is not tested

| Gap | Why it matters |
|---|---|
| **Real Claude output** | The mock tests our handling, not model quality. Run the five features against the live API with the real key and review the results before presenting. |
| Docker image and `docker compose up` | Docker was not available on the build machine. The Dockerfile, entrypoint and compose file were written and reviewed but **not executed**. Test once on the VPS. |
| Browser interaction beyond rendering | Clicking through forms was tested through the API, not through a scripted browser session. |
| Load and concurrency | Not tested. Expected scale is small. |
| Accuracy of recommendations | Data is synthetic and generated from the same simple model the method assumes. No accuracy claim can be made. Use Nestlé's historical trials for any real evaluation. |
| Security review | Not performed. See `PRODUCTION_GAPS.md`. |
| Accessibility | Labels, focus states and keyboard use were considered, not audited. |
| Mobile layout | Layout collapses to one column below 900 px; not checked on a device. |

## Suggested acceptance tests for a Nestlé pilot

1. On a held-out set of past launches, does the recommended window contain the settings of the accepted run? Agree the target with Nestlé.
2. For each recommendation, are the evidence launches ones an engineer would call similar?
3. Does every weight change, approval and result appear in the audit log with a name and reason?
4. First-pass rate, runs per launch and loss per launch, compared between launches that used a recommendation and similar launches that did not.

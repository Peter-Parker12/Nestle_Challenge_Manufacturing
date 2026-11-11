# Architecture

## Overview

```
Browser ── Cloudflare tunnel ── :9361 ── Next.js app (UI + API routes)
                                           │
                       ┌───────────────────┼────────────────────┐
                       │                   │                    │
                 Engine (pure code)   Repository (SQL)     AI layer (server only)
                 weights, similarity, tx(), audit context   Anthropic SDK, schemas,
                 windows, risk flags                        checks, call log
                       │                   │                    │
                       └──────────── PostgreSQL 16 ─────────────┘
                              (rules also enforced by triggers)
```

One Next.js application serves the UI and the JSON API. PostgreSQL holds all state. The Claude API is called only from server code.

> The app is now one platform for several use cases: see `LINE_INTELLIGENCE.md`.

## Copilot (MCP)

A second front door to the same repository and engine: `/mcp` serves nine MCP tools to Microsoft Copilot over Streamable HTTP. It runs as a fixed service account, checks that account's role on every tool, and exposes no tool that approves, decides or changes setup. See `COPILOT_MCP.md`.

## Principles

1. **The numbers come from code.** Similarity, windows, clipping and risk flags are computed by the engine in `lib/engine`. Claude explains and reads; it never produces a recommended value. This keeps every recommendation reproducible and testable.
2. **Rules live in the database too.** Closed launches are read-only, run numbering, reason codes before the next run, immutability of recommendations, decisions and audit are enforced by triggers and constraints, so a bug or a direct SQL session cannot bypass them.
3. **Configuration is data.** Categories, process steps, parameters, attributes, quality tests, line capability and expert rules are rows. Adding a product category needs no code change.
4. **Append-only where it matters.** Recommendations, evidence, decisions, weight items and audit events cannot be updated or deleted. Corrections create new rows.
5. **Sources stay replaceable.** Modules read the `core` and `cfg` tables. A staging schema (`stg`) exists for raw imports from any source (Excel, SharePoint, SAP, an API) before they are mapped into `core`.
6. **Humans decide.** Every plan is approved by a person. Run results are calculated, then reviewed.

## Code layout

| Path | Purpose |
|---|---|
| `app/` | Pages (dashboard, launches, new launch, ask, configuration, audit) and API routes under `app/api` |
| `components/` | `LaunchView` (the main workflow screen), navigation, API helper |
| `lib/engine/` | Pure, unit-tested logic: `weights.ts`, `recommend.ts`, `outcome.ts`, `types.ts` |
| `lib/repo.ts` | All SQL for the workflow, using transactions that carry the user id and reason into audit triggers |
| `lib/ai/` | `client.ts` (Anthropic calls and logging), `features.ts` (five features), `checks.ts` (output guardrails) |
| `lib/auth.ts`, `lib/permissions.ts` | Role checks. Permissions are shared with the browser only to hide buttons; the server always re-checks |
| `db/migrations/` | Forward-only SQL migrations |
| `scripts/` | `migrate.ts`, `seed.ts` (synthetic data), `pg-local.sh`, `docker-entrypoint.sh` |
| `tests/` | Unit tests, end-to-end API test, mock of the Claude API |

## Request flow: generating a recommendation

1. `POST /api/launches/{id}/recommend` checks the user's role.
2. `repo.createRecommendation` loads the category configuration, the target product's attributes, line capability, active expert rules, the resolved weights (recipe over category over default) and the history of closed, accepted launches.
3. `engine.recommend` ranks the launches by weighted distance, builds a window per parameter, clips to line capability, calculates confidence and risk flags.
4. In one transaction the result is stored as a recommendation, its lines, evidence and flags, together with a snapshot of the exact weights, the engine version and the history cutoff time.
5. The audit trigger records the insert with the user id.

## Request flow: a Claude feature (explain)

1. The server builds a bounded context package from stored rows (never raw tables).
2. One forced tool call to Claude returns structured output, which is validated against a schema.
3. Guardrails check cited launch codes against the evidence set and numbers against the data. Problems are shown to the user.
4. The call, with the ids of the rows it was given, is written to `ai.call_log`.

## Technology choices

| Choice | Reason |
|---|---|
| Next.js 15, TypeScript | One deployable unit for UI and API; the team already uses it |
| PostgreSQL 16 | Triggers and constraints for rules, JSONB for snapshots, runs on Azure Database for PostgreSQL |
| `pg` without an ORM | Few, explicit queries; transactions carry audit context through `set_config` |
| zod | Validation of every request body and every Claude output |
| Anthropic SDK | Forced tool use for structured output, tool loop for history questions |

## Deployment

Docker Compose with two services: `db` (Postgres 16, named volume, not published) and `app` (port 9361). The entrypoint applies migrations, optionally seeds, then starts Next.js. See the README and the runbook.

## What is intentionally not here

Single sign-on, rate limiting, object storage for documents (demo stores uploaded files in the database), cross-category matching, background jobs, multi-plant row-level security. See `PRODUCTION_GAPS.md`.

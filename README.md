# BAF-1 Launch Accelerator

Working demo for the Nestlé Vietnam AI Reinvention use case **BAF-1: AI New Product Launch Accelerator**.

For each new product launch it finds similar past launches, recommends a starting recipe and process window, flags the risks, and records every trial run, decision and outcome so the next recommendation is better. Engineers review and approve every plan. Nothing is applied automatically.

All data in this repository is **synthetic**. Nothing here is Nestlé data.

## What is in the demo

| Area | What it does |
|---|---|
| Recommendation | Weighted similarity search over closed launches, a window per process parameter, clipped to line capability, with the evidence launches shown. Runs in code, deterministic, no AI needed. |
| Risk flags | Low evidence, rework history, out-of-range product, disagreement between similar launches, expert (SME) rules, clipped values. |
| Weights | Engineers set 0 to 5 importance per attribute and parameter, at platform, category and recipe level, with a reason and an audit trail. Effect can be previewed before saving. |
| Launch, run, outcome | A product launch holds many trial runs. Run result (Pass, Marginal, Fail) is calculated from quality results, not typed. Reason codes, next step, technical acceptance by QA. |
| Claude features | Describe a product in words to fill the form; plain-language explanation of a recommendation; ask questions about the history with checked citations; import a trial report (PDF or text); suggested expert rules from failure patterns. |
| Microsoft Copilot (MCP) | An MCP server at `/mcp` lets Copilot Studio look up launches, draft a launch, ask for a recommendation and ask why. It can never approve or decide: those tools do not exist. API-key sign-in, a fixed service role, rate limit, audit. See [docs/COPILOT_MCP.md](docs/COPILOT_MCP.md). |
| Process setup | Category owners and plant admins manage process steps, parameters, quality tests and per-line capability, with the same retire-never-delete rules. See [docs/PROCESS_SETUP.md](docs/PROCESS_SETUP.md). |
| Custom product fields | Category owners add fields per category (number, choice, yes/no, text, date), choose whether each affects matching, back-fill values for existing launches, and decide whether Claude may see them. See [docs/CUSTOM_FIELDS.md](docs/CUSTOM_FIELDS.md). |
| Starting database | **Import history** page: upload previous launches and runs as CSV, with a per-category template, a row-by-row check before anything is saved, and an export in the same format. See [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md). |
| Governance | Roles and permissions, append-only audit log, database-enforced business rules, full reproducibility of every recommendation. |

## Quick start (local development, no Docker)

Requires Node 22 and PostgreSQL 16 (Homebrew: `brew install postgresql@16`).

```bash
npm install
cp .env.example .env.local        # set DATABASE_URL, optionally ANTHROPIC_API_KEY
npm run db:local:start            # project-local Postgres on port 5433 (data in .pgdata)
npm run db:setup                  # migrations + synthetic demo data
npm run dev                       # http://localhost:9361
```

Without `ANTHROPIC_API_KEY` the engine, workflow and audit all work. The Claude features show a clear "unavailable" message, and the explanation falls back to a standard text.

## Deploy on the VPS (Docker Compose, port 9361)

```bash
cp .env.example .env              # a ready .env is also provided; set ANTHROPIC_API_KEY in it
docker compose up -d --build
docker compose logs -f app
```

- The app listens on **9361**. Point the Cloudflare tunnel at `http://localhost:9361`.
- Postgres is **not** published. It is reachable only from the app container.
- On first start the app applies migrations and, when the database is empty, seeds it according to `SEED_MODE`: `demo` (synthetic history, for presenting), `config` (users, lines, parameters and rules only, so you can load your own history on the **Import history** page), or `none`.
- Compose binds `127.0.0.1:9361`. If `cloudflared` itself runs in a container, change the mapping to `"9361:9361"` or put both on one network.
- Health check: `GET /api/health`.

See [docs/RUNBOOK.md](docs/RUNBOOK.md) for backup, restore, key rotation and troubleshooting.

## Starting from your own history

Set `SEED_MODE=config` before the first start (or run `npx tsx scripts/seed.ts --force --config-only` locally), open **Import history**, download the template for the category, fill it with previous runs, check it, and import. Details, column meanings and rules are in [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md).

## Using the demo

1. Open **Launches** and the open demo launch (`Choco Malt RTD 200ml (demo)`).
2. As **Linh Tran (R&D)**: Generate recommendation, read the flags and evidence, approve.
3. Switch to **Minh Nguyen (Process)**: start the run and enter results.
4. Review the run, then switch to **Hoa Pham (QA)** to record technical acceptance.
5. The dashboard now compares launches that used a recommendation with history.

The full click-by-click script is in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## Tests

```bash
npm test                                              # 80 unit tests: engine, weights, outcome rules, AI output checks, CSV import rules, custom fields, process setup
npm run typecheck
API_BASE=http://localhost:9361 npm run test:int       # 20 end-to-end checks (writes to the DB; reseed after)
API_BASE=http://localhost:9361 npx vitest run tests/fields.int.test.ts   # 10 custom-field checks (needs a freshly seeded DB)
API_BASE=http://localhost:9361 npx vitest run tests/process.int.test.ts  # 9 process-setup checks (needs a freshly seeded DB)
API_BASE=http://localhost:9361 MCP_API_KEY=<key> npm run test:mcp          # 15 MCP checks (server started with the same key; fresh DB)
```

To exercise the Claude code paths without a key, run `node tests/mock-claude.mjs` and start the app with
`ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:9999`. See [docs/TEST_PLAN.md](docs/TEST_PLAN.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, design decisions |
| [docs/COPILOT_MCP.md](docs/COPILOT_MCP.md) | Connecting Microsoft Copilot: tools, safeguards, setup, limits |
| [docs/PROCESS_SETUP.md](docs/PROCESS_SETUP.md) | Parameters, quality tests and line capability: rules and what a new one means for recommendations |
| [docs/CUSTOM_FIELDS.md](docs/CUSTOM_FIELDS.md) | Product fields: kinds, lifecycle, rules, missing values, back-fill, AI handling |
| [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md) | Loading historical data: file format, rules, export |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Schemas, tables, constraints, what the engine and Claude read |
| [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) | Every rule, where it is enforced, how it is tested |
| [docs/API.md](docs/API.md) | HTTP endpoints, roles, errors |
| [docs/AI_DESIGN.md](docs/AI_DESIGN.md) | What Claude does and does not do, guardrails, logging |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | What is tested and how, and what is not |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | Presentation walk-through |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operating the deployment |
| [docs/PRODUCTION_GAPS.md](docs/PRODUCTION_GAPS.md) | What must change before a real pilot |

## Look and feel

The interface follows the Workforce Solution brand: Deep Navy sidebar and highlight panel, Cobalt actions, Electric Teal accents, Vermilion for errors, Montserrat headings and Poppins text, with the Workforce Solution logo. The tokens are at the top of `app/globals.css`. Text-sized teal, cobalt and vermilion are darkened one step so they stay readable on white; the brand values are used for fills. The logo and favicon files in `public/brand` and `app/icon.png` come from the Workforce Solution website project. The Nestlé name appears only as the programme this demo is prepared for; no Nestlé branding is used.

## Honest status

This is a **demo built with production-style engineering**: migrations, validated inputs, role checks, database-level rules, audit, tests, health check, containerised deployment. It is **not** production-hardened. The main gaps are single sign-on (the role switcher is a demo stub), no rate limiting, no cross-category matching, and the recommendation method has only been validated on synthetic data, so no accuracy claim is made. Details in [docs/PRODUCTION_GAPS.md](docs/PRODUCTION_GAPS.md).

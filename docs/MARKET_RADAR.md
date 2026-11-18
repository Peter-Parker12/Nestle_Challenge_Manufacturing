# Market Move Radar (SALES-2): how it is built

Next.js 15 (server components for reads, client components for forms), TypeScript strict, PostgreSQL 16, Claude API, one app on port 9361.

## Principles
1. **Numbers come from code.** Detection, elasticity, exposure and scenarios are pure TypeScript in `lib/engine` (unit-tested, versioned `radar-engine-1.0.0`). Claude reads shelf photos, writes the brief and answers questions with checked citations. It never produces a number the engine would.
2. **Humans decide.** Nothing is auto-accepted. The system writes to no outside system.
3. **Rules live in the database too.** Price, sales, move, scenario, decision, photo and brief tables are append-only (trigger). A decision needs a reason to reject or defer; a price match can only be accepted by a category manager; an AI photo reading can never be overwritten and a correction needs a reason. Every change is audited with the user.
4. **Sources are replaceable.** Feeds are collectors behind one interface; the demo uses a synthetic one.

## Layout
| Path | Purpose |
|---|---|
| `db/migrations/001_init.sql` | Schemas `cfg`, `mkt`, `ai`, `audit` and the rules |
| `lib/engine/` | `detect.ts`, `elasticity.ts`, `scenario.ts`, `types.ts` (pure) |
| `lib/radar.ts` | Repository: world loading, refresh, moves, decisions, photos, backtest |
| `lib/ai/` | `client.ts` (Claude calls and log), `vision.ts`, `brief.ts`, `ask.ts`, `cite.ts` |
| `lib/mockShelf.ts`, `lib/mockPhoto.ts` | Generated shelf photos (labelled MOCK) |
| `app/`, `components/` | Radar, move detail, shelf photos, brief, ask, setup, audit |
| `scripts/` | `seed.ts` (synthetic data with planted events), `migrate.ts`, `pg-local.sh` |
| `tests/` | Engine unit tests, end-to-end API tests, mock of the Claude API |

## Run locally
```
npm install
npm run db:local:start            # Postgres on :5433 (needs Homebrew postgresql@16)
cp .env.example .env.local        # set DATABASE_URL=postgres://radar:radar@localhost:5433/radar
npm run db:migrate && npm run db:seed
npm run dev                       # http://localhost:9361
```
Add `ANTHROPIC_API_KEY` to use photo reading, the written brief and Ask the radar. Without it the radar, scenarios, decisions and a standard brief all work.

## Tests
```
npx vitest run tests/engine.test.ts                # 15 unit tests
node tests/mock-claude.mjs &                       # mock Claude on :9999
ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:9999 npm run dev &
npx tsx scripts/seed.ts --force
API_BASE=http://localhost:9361 DATABASE_URL=... npx vitest run tests/radar.int.test.ts   # 20 tests
```

## Docker
`docker compose up -d --build` with `.env` from `.env.example` (`SEED_MODE=demo`). Port 9361 for a Cloudflare tunnel. Not yet run in this build.

## Honest limits
- Data is synthetic. The backtest checks the code, not the market.
- Elasticity is a simple regression, not a forecast. The diversion rate, gross margin and shelf uplift are assumptions to confirm with Nestlé.
- Claude features are tested against a mock, not the real API.
- General trade is covered by photos and a weekly audit only; the demo has no city or store-level geography.
- No real feed, no sign-in (demo role switcher), no notifications or Teams delivery, no CSV import yet.

# Runbook

For whoever operates the deployment on the VPS.

## Services

| Service | Image | Port | Data |
|---|---|---|---|
| `app` | built from `Dockerfile` (Node 22) | 9361 (host `127.0.0.1:9361`) | none |
| `db` | `postgres:16-alpine` | 5432, internal only | named volume `baf1_pgdata` |

The Cloudflare tunnel should forward to `http://localhost:9361`.

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database credentials. The supplied `.env` has a generated password. |
| `ANTHROPIC_API_KEY` | Claude API key. Empty means the Claude features are off. |
| `CLAUDE_MODEL_MAIN`, `CLAUDE_MODEL_FAST` | Models for explanation, reading, questions (main) and form parsing (fast) |
| `MIN_MATCHED_LAUNCHES` | Below this many similar launches, confidence is Low (default 3) |
| `TOP_N_NEIGHBOURS` | Similar launches used per recommendation (default 7) |
| `SEED_MODE` | On first start with an empty database: `demo` loads synthetic history and a demo launch, `config` loads users, lines, parameters and rules only (then use **Import history**), `none` does nothing |
| `DEMO_USER_SWITCHER` | `false` removes the role switcher. Set it when real sign-on is in front of the app. |

`.env` must never be committed or shared. It is listed in `.gitignore` and `.dockerignore`.

## Start, stop, update

```bash
docker compose up -d --build        # first start or after code changes
docker compose ps
docker compose logs -f app
docker compose down                 # stop, keeps data
docker compose down -v              # stop AND delete the database volume
```

On start the entrypoint applies any new migrations (`db/migrations`, tracked in `public.schema_migrations`), seeds if enabled and the database is empty, then starts the app.

## Health

`GET /api/health` returns `{status, db, ai, engine}`. A non-200 means the database is unreachable. The container health check calls it every 15 seconds.

## Starting with your own history

Set `SEED_MODE=config`, start, then use **Import history** as the plant admin, category owner or process engineer. See `IMPORT_FORMAT.md`. To switch an existing demo database to your own data, wipe it with `docker compose exec app npx tsx scripts/seed.ts --force --config-only` (this deletes everything) and import.

## Reset the demo

```bash
docker compose exec app npx tsx scripts/seed.ts --force
```

This **deletes all data** and reloads the synthetic set. Do not run it on a database that holds real data.

## Backup and restore

```bash
# backup
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > baf1-$(date +%F).sql.gz
# restore into an empty database
gunzip -c baf1-2026-11-09.sql.gz | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

The audit log is part of the database and is included.

## Rotate the Claude key

Edit `ANTHROPIC_API_KEY` in `.env`, then `docker compose up -d app`. No rebuild needed.

## Troubleshooting

| Symptom | Likely cause and action |
|---|---|
| App container restarts | `docker compose logs app`. Usually the database is not ready or a migration failed. |
| `db: false` in health | Database container unhealthy; check `docker compose logs db` and the credentials in `.env` |
| Claude features say unavailable | Key empty or missing in `.env`; restart `app` after setting it |
| Claude features return errors or rate limit messages | Check the key's quota; calls and errors are in `ai.call_log` |
| Cookie or role switcher does nothing behind the tunnel | Cloudflare must pass `X-Forwarded-Proto`. The app sets the `Secure` flag only for `https`. |
| A change was refused with "read-only" | The launch is Closed. This is intended (BR-15). |
| Cannot reach the app from the tunnel | Compose binds `127.0.0.1:9361`. If `cloudflared` runs in a container, use `"9361:9361"` or a shared network. |

## Useful queries

```sql
-- AI usage and cost drivers
select purpose, count(*), sum(input_tokens) in_tok, sum(output_tokens) out_tok, count(*) filter (where not output_valid) invalid
from ai.call_log group by 1;

-- Who changed weights and why
select at, (select name from cfg.app_user u where u.id=e.user_id) as who, reason
from audit.event e where entity='rec.weight_set' order by id desc limit 20;
```

## Security notes for the operator

- Postgres is not published. Do not add a `ports:` entry to the `db` service.
- The demo role switcher lets anyone who can reach the page act as any role. Keep the tunnel behind Cloudflare Access (or equivalent) while it is on.
- Uploaded reports are stored in the database (`ai.document`) for the demo. They are not scanned.

#!/bin/sh
set -e
echo "[baf1] applying migrations"
npx tsx scripts/migrate.ts
# SEED_MODE: demo = synthetic history + demo launch, config = users/lines/parameters only (then import your history), none = nothing.
# SEED_DEMO_DATA=true is still honoured for older .env files.
MODE="${SEED_MODE:-}"
if [ -z "$MODE" ] && [ "$SEED_DEMO_DATA" = "true" ]; then MODE=demo; fi
case "$MODE" in
  demo)   echo "[baf1] seeding demo data if the database is empty";            npx tsx scripts/seed.ts --if-empty ;;
  config) echo "[baf1] seeding reference configuration if the database is empty"; npx tsx scripts/seed.ts --if-empty --config-only ;;
  *)      echo "[baf1] no seeding (SEED_MODE=${MODE:-none})" ;;
esac
echo "[baf1] starting on port ${PORT:-9361}"
exec npx next start -p "${PORT:-9361}"

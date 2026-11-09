#!/bin/bash
# Project-local Postgres for development without Docker. Data lives in .pgdata, port 5433.
set -e
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PGDATA="$DIR/.pgdata"
SOCK="/tmp/baf1pg"
case "$1" in
  start)
    mkdir -p "$SOCK"
    if [ ! -d "$PGDATA" ]; then
      initdb -D "$PGDATA" -U baf1 --auth=trust >/dev/null
    fi
    pg_ctl -D "$PGDATA" -o "-p 5433 -k $SOCK -c listen_addresses=127.0.0.1" -l "$DIR/.pgdata/server.log" -w start
    psql -h 127.0.0.1 -p 5433 -U baf1 -d postgres -tc "select 1 from pg_database where datname='baf1'" | grep -q 1 || \
      createdb -h 127.0.0.1 -p 5433 -U baf1 baf1
    ;;
  stop) pg_ctl -D "$PGDATA" -w stop ;;
  reset) "$0" stop || true; rm -rf "$PGDATA"; "$0" start ;;
  *) echo "usage: $0 start|stop|reset"; exit 1 ;;
esac

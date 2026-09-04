#!/usr/bin/env bash
# supervisord entrypoint for Postgres (runs as the postgres user via
# user=postgres in supervisord.conf). Self-healing boot:
#   - pgdata intact (normal restart) → straight exec postgres.
#   - fresh container disk (pod resume/recreate wiped /var/lib) → initdb +
#     create litellm/dashboard + restore /workspace/backups/latest.sql when
#     present, so no user data is ever lost on Stop/Start.
# runpod-setup.sh duplicates this for its pre-supervisord password sync;
# both paths are idempotent, so whichever runs first wins harmlessly.
set -euo pipefail

PGDATA="/var/lib/postgresql/pgdata"
PG_BIN="/workspace/bin/pg_bin"
BACKUP="/workspace/backups/latest.sql"

if [[ ! -f "${PGDATA}/PG_VERSION" ]]; then
  echo "[postgres-entrypoint] fresh disk — initializing cluster at ${PGDATA}"
  # Parent/socket dirs are created as root by runpod-start.sh / setup.sh;
  # fail with a pointer instead of a cryptic initdb error if absent.
  if ! mkdir -p "${PGDATA}" 2>/dev/null; then
    echo "[postgres-entrypoint] FATAL: cannot create ${PGDATA} (run as postgres user)." >&2
    echo "[postgres-entrypoint] Run scripts/runpod-start.sh or runpod-setup.sh as root first." >&2
    exit 1
  fi
  mkdir -p /var/run/postgresql 2>/dev/null || true
  "${PG_BIN}/initdb" -D "${PGDATA}" --auth-local=peer --auth-host=scram-sha-256
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = 5432"
    echo "unix_socket_directories = '/var/run/postgresql'"
  } >> "${PGDATA}/postgresql.conf"
  if ! grep -qE '^host\s+all\s+all\s+127\.0\.0\.1/32' "${PGDATA}/pg_hba.conf"; then
    echo "host all all 127.0.0.1/32 scram-sha-256" >> "${PGDATA}/pg_hba.conf"
  fi

  "${PG_BIN}/pg_ctl" -D "${PGDATA}" -l "${PGDATA}/init.log" start
  sleep 2
  for db in litellm dashboard; do
    if ! "${PG_BIN}/psql" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1; then
      "${PG_BIN}/psql" -d postgres -c "CREATE DATABASE ${db} OWNER postgres"
    fi
  done

  if [[ -f "${BACKUP}" ]]; then
    echo "[postgres-entrypoint] restoring user data from ${BACKUP}"
    "${PG_BIN}/psql" -d postgres -c 'DROP DATABASE IF EXISTS litellm;'
    "${PG_BIN}/psql" -d postgres -c 'DROP DATABASE IF EXISTS dashboard;'
    "${PG_BIN}/psql" -d postgres -v ON_ERROR_STOP=1 -f "${BACKUP}"
    echo "[postgres-entrypoint] restore complete"
  else
    echo "[postgres-entrypoint] no volume backup found — starting with empty databases"
  fi
  "${PG_BIN}/pg_ctl" -D "${PGDATA}" stop
fi

exec "${PG_BIN}/postgres" -D "${PGDATA}"

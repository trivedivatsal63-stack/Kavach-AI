#!/usr/bin/env bash
# Runs automatically on first container start (mounted into
# /docker-entrypoint-initdb.d/ by docker-compose.yml). Reads
# POSTGRES_MULTIPLE_DATABASES (comma-separated) and creates one database
# per entry on the single postgres instance, owned by POSTGRES_USER.
set -euo pipefail

create_database() {
	local database=$1
	echo "Creating database '$database' (owner: $POSTGRES_USER)"
	psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
		SELECT 'CREATE DATABASE "$database" OWNER "$POSTGRES_USER"'
		WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$database')\gexec
EOSQL
}

if [ -n "${POSTGRES_MULTIPLE_DATABASES:-}" ]; then
	echo "Multiple databases requested: $POSTGRES_MULTIPLE_DATABASES"
	IFS=',' read -ra DATABASES <<< "$POSTGRES_MULTIPLE_DATABASES"
	for db in "${DATABASES[@]}"; do
		create_database "$(echo "$db" | xargs)"
	done
	echo "Multiple databases created"
fi

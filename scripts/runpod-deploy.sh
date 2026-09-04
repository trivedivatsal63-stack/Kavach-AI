#!/usr/bin/env bash
# Bring up (or reload) the full Kavach-AI stack on a RunPod pod.
# Idempotent: safe to re-run after code changes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

SUPERVISORD_CONF="${REPO_ROOT}/scripts/supervisord.conf"
ENV_FILE="${REPO_ROOT}/.env"
LOG_DIR="${REPO_ROOT}/logs"
mkdir -p "${LOG_DIR}"

upsert_env() {
  local key="$1"
  local value="$2"
  local file="$3"
  if grep -qE "^${key}=" "${file}" 2>/dev/null; then
    # portable in-place replace (no GNU sed -i assumption quirks)
    local tmp
    tmp="$(mktemp)"
    awk -v k="${key}" -v v="${value}" '
      BEGIN { done=0 }
      index($0, k "=") == 1 { print k "=" v; done=1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "${file}" > "${tmp}"
    mv "${tmp}" "${file}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${file}"
  fi
}

is_placeholder() {
  local val="${1:-}"
  case "${val}" in
    ""|change-me*|sk-change-me*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "==> Repo root: ${REPO_ROOT}"

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${REPO_ROOT}/.env.runpod.example" "${ENV_FILE}"
  echo
  echo "Created ${ENV_FILE} from .env.runpod.example."
  echo "Fill in real secrets before continuing:"
  echo "  POSTGRES_PASSWORD, JWT_SECRET, LITELLM_MASTER_KEY,"
  echo "  SMTP_USER / SMTP_PASS (and optionally HUGGING_FACE_HUB_TOKEN),"
  echo "then re-run: ./scripts/runpod-deploy.sh"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "${ENV_FILE}"
set +a

if is_placeholder "${POSTGRES_PASSWORD:-}" \
  || is_placeholder "${JWT_SECRET:-}" \
  || is_placeholder "${LITELLM_MASTER_KEY:-}"; then
  echo "ERROR: placeholder secrets still present in .env."
  echo "Set POSTGRES_PASSWORD, JWT_SECRET, and LITELLM_MASTER_KEY to real values, then re-run."
  exit 1
fi

if [[ -z "${RUNPOD_POD_ID:-}" ]]; then
  echo "ERROR: RUNPOD_POD_ID not found — this script must run on an actual RunPod pod, not locally."
  exit 1
fi

FRONTEND_URL="https://${RUNPOD_POD_ID}-5173.proxy.runpod.net"
BACKEND_URL="https://${RUNPOD_POD_ID}-4001.proxy.runpod.net"
LITELLM_URL="https://${RUNPOD_POD_ID}-4000.proxy.runpod.net"

echo "==> Public proxy URLs"
echo "    frontend: ${FRONTEND_URL}"
echo "    backend:  ${BACKEND_URL}"
echo "    litellm:  ${LITELLM_URL}"

upsert_env "CORS_ORIGIN" "${FRONTEND_URL}" "${ENV_FILE}"
upsert_env "VITE_API_BASE_URL" "${BACKEND_URL}" "${ENV_FILE}"
upsert_env "VITE_LITELLM_BASE_URL" "${LITELLM_URL}" "${ENV_FILE}"

# URL-encode password for connection strings (handles @ : / etc.)
PG_PASS_ENC="$(
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" python3 - <<'PY'
import os, urllib.parse
print(urllib.parse.quote(os.environ["POSTGRES_PASSWORD"], safe=""))
PY
)"
DATABASE_URL="postgresql://${POSTGRES_USER}:${PG_PASS_ENC}@127.0.0.1:5432/dashboard"
LITELLM_DATABASE_URL="postgresql://${POSTGRES_USER}:${PG_PASS_ENC}@127.0.0.1:5432/litellm"

upsert_env "DATABASE_URL" "${DATABASE_URL}" "${ENV_FILE}"
upsert_env "LITELLM_DATABASE_URL" "${LITELLM_DATABASE_URL}" "${ENV_FILE}"
upsert_env "LITELLM_BASE_URL" "http://127.0.0.1:4000" "${ENV_FILE}"
upsert_env "VLLM_BASE_URL" "http://127.0.0.1:8000" "${ENV_FILE}"
upsert_env "QDRANT_URL" "http://127.0.0.1:6333" "${ENV_FILE}"
upsert_env "EMBEDDING_BASE_URL" "http://127.0.0.1:8002" "${ENV_FILE}"
upsert_env "SEARXNG_URL" "http://127.0.0.1:8889" "${ENV_FILE}"
upsert_env "PORT" "4001" "${ENV_FILE}"

set -a
# shellcheck disable=SC1091
source "${ENV_FILE}"
set +a
export CORS_ORIGIN VITE_API_BASE_URL VITE_LITELLM_BASE_URL
export DATABASE_URL LITELLM_DATABASE_URL LITELLM_BASE_URL VLLM_BASE_URL
export FRONTEND_URL BACKEND_URL LITELLM_URL
export HF_HOME="${HF_HOME:-/workspace/.hf-cache}"

# backend/.env is what node actually reads (dotenv loads CWD/backend/.env;
# supervisord only injects service URLs). Derive it from the root .env so
# there is a single source of truth — a hand-copied backend/.env with stale
# model names or placeholder secrets silently breaks completions, master-key
# calls and CORS. printf (not echo/heredoc) so $/backticks in secrets pass
# through literally.
echo "==> Syncing backend/.env from root .env"
{
  printf '%s=%s\n' "DATABASE_URL" "${DATABASE_URL}"
  printf '%s=%s\n' "JWT_SECRET" "${JWT_SECRET}"
  printf '%s=%s\n' "LITELLM_BASE_URL" "http://127.0.0.1:4000"
  printf '%s=%s\n' "LITELLM_MASTER_KEY" "${LITELLM_MASTER_KEY}"
  printf '%s=%s\n' "CHAT_MODEL" "${CHAT_MODEL:-mistral-small-24b-awq}"
  printf '%s=%s\n' "RAG_CHAT_MODEL" "${RAG_CHAT_MODEL:-${CHAT_MODEL:-mistral-small-24b-awq}}"
  printf '%s=%s\n' "MODEL_MAX_CONTEXT_TOKENS" "${MODEL_MAX_CONTEXT_TOKENS:-32768}"
  printf '%s=%s\n' "QDRANT_URL" "http://127.0.0.1:6333"
  printf '%s=%s\n' "EMBEDDING_BASE_URL" "http://127.0.0.1:8002"
  printf '%s=%s\n' "EMBEDDING_MODEL" "${EMBEDDING_MODEL:-sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2}"
  printf '%s=%s\n' "EMBEDDING_DIM" "${EMBEDDING_DIM:-384}"
  printf '%s=%s\n' "SEARXNG_URL" "http://127.0.0.1:8889"
  printf '%s=%s\n' "SUPERADMIN_EMAIL" "${SUPERADMIN_EMAIL:-}"
  printf '%s=%s\n' "SMTP_HOST" "${SMTP_HOST:-}"
  printf '%s=%s\n' "SMTP_PORT" "${SMTP_PORT:-587}"
  printf '%s=%s\n' "SMTP_SECURE" "${SMTP_SECURE:-false}"
  printf '%s=%s\n' "SMTP_USER" "${SMTP_USER:-}"
  printf '%s=%s\n' "SMTP_PASS" "${SMTP_PASS:-}"
  printf '%s=%s\n' "SMTP_FROM" "${SMTP_FROM:-}"
  printf '%s=%s\n' "SMTP_TLS_INSECURE" "${SMTP_TLS_INSECURE:-}"
  printf '%s=%s\n' "PORT" "4001"
  printf '%s=%s\n' "CORS_ORIGIN" "${CORS_ORIGIN}"
} > "${REPO_ROOT}/backend/.env"
echo "    backend/.env synced"

# Fail fast if setup never initialized the cluster (wrong order).
if [[ ! -f /var/lib/postgresql/pgdata/PG_VERSION ]]; then
  echo "ERROR: Postgres cluster not initialized — run ./scripts/runpod-setup.sh first."
  exit 1
fi

# Sync Postgres role password to match .env (setup may have run before secrets existed)
if [[ -x /workspace/bin/pg_bin/psql ]]; then
  echo "==> Syncing Postgres role password"
  # Start briefly via peer auth if not already up under supervisord
  if ! /workspace/bin/pg_bin/pg_isready -h /var/run/postgresql -q 2>/dev/null \
     && ! /workspace/bin/pg_bin/pg_isready -h 127.0.0.1 -q 2>/dev/null; then
    runuser -u postgres -- /workspace/bin/pg_bin/pg_ctl -D /var/lib/postgresql/pgdata -l "${LOG_DIR}/postgres-predeploy.log" start || true
    sleep 2
    STARTED_PG_FOR_SYNC=1
  fi
  runuser -u postgres -- /workspace/bin/pg_bin/psql -d postgres -v ON_ERROR_STOP=1 \
    -c "ALTER USER postgres WITH PASSWORD '${POSTGRES_PASSWORD//\'/\'\'}'" || true
  if [[ "${STARTED_PG_FOR_SYNC:-0}" == "1" ]]; then
    runuser -u postgres -- /workspace/bin/pg_bin/pg_ctl -D /var/lib/postgresql/pgdata stop || true
  fi
fi

echo "==> Building frontend with baked proxy URLs"
cd "${REPO_ROOT}/frontend"
VITE_API_BASE_URL="${BACKEND_URL}" VITE_LITELLM_BASE_URL="${LITELLM_URL}" npm run build
cd "${REPO_ROOT}"

# Ensure backend dist exists (re-build if missing after a fresh pull)
if [[ ! -f "${REPO_ROOT}/backend/dist/index.js" ]]; then
  echo "==> Building backend"
  (cd "${REPO_ROOT}/backend" && npm ci && npm run build)
fi

wait_http() {
  local name="$1"
  local url="$2"
  local timeout_s="$3"
  local elapsed=0
  echo -n "    waiting for ${name} (${url})…"
  while (( elapsed < timeout_s )); do
    if curl -fsS --max-time 5 "${url}" >/dev/null 2>&1; then
      echo " ready (${elapsed}s)"
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    echo -n "."
  done
  echo
  echo "TIMEOUT: ${name} did not become ready within ${timeout_s}s."
  echo "  Check logs: supervisorctl -c ${SUPERVISORD_CONF} tail ${name}"
  return 1
}

SOCK="${LOG_DIR}/supervisor.sock"
if [[ -S "${SOCK}" ]] && supervisorctl -c "${SUPERVISORD_CONF}" status >/dev/null 2>&1; then
  echo "==> Stopping existing supervisord (so new .env exports are picked up)"
  supervisorctl -c "${SUPERVISORD_CONF}" shutdown || true
  # Wait for socket to clear
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [[ -S "${SOCK}" ]] || break
    sleep 1
  done
  rm -f "${SOCK}" "${LOG_DIR}/supervisord.pid" 2>/dev/null || true
fi

echo "==> Starting supervisord"
supervisord -c "${SUPERVISORD_CONF}"
sleep 3

echo "==> Health checks (first boot may download ~19GB of model weights)"
# Postgres is up when backend can connect; poll public services + vLLM.
FAILED=0
wait_http "qdrant" "http://127.0.0.1:6333/readyz" 120 || FAILED=1
wait_http "embedding" "http://127.0.0.1:8002/health" 180 || FAILED=1
wait_http "vllm" "http://127.0.0.1:8000/health" 1800 || FAILED=1
wait_http "litellm" "http://127.0.0.1:4000/health/readiness" 300 || FAILED=1
wait_http "backend" "http://127.0.0.1:4001/health" 180 || FAILED=1
wait_http "frontend" "http://127.0.0.1:5173" 120 || FAILED=1

if (( FAILED != 0 )); then
  echo
  echo "One or more services failed health checks."
  echo "  supervisorctl -c ${SUPERVISORD_CONF} status"
  echo "  supervisorctl -c ${SUPERVISORD_CONF} tail <service>"
  exit 1
fi

# Snapshot Postgres to the volume (survives stop/resume/recreate). Keeps the
# last 5 timestamped dumps + latest.sql, which runpod-setup.sh auto-restores
# on a fresh container disk. Always run scripts/backup-runpod.sh before
# stopping the pod — this deploy-time snapshot is a safety net, not a
# substitute (a crash between deploy and Stop would otherwise lose data).
echo "==> Backing up Postgres to /workspace/backups"
mkdir -p /workspace/backups
BACKUP_TS="$(date +%Y%m%d-%H%M%S)"
if runuser -u postgres -- /workspace/bin/pg_bin/pg_dumpall -f "/workspace/backups/pg-${BACKUP_TS}.sql"; then
  cp -f "/workspace/backups/pg-${BACKUP_TS}.sql" /workspace/backups/latest.sql
  ls -t /workspace/backups/pg-*.sql 2>/dev/null | tail -n +6 | xargs -r rm -f
  echo "    backup saved (latest.sql refreshed)"
else
  echo "    WARNING: Postgres backup failed — run scripts/backup-runpod.sh manually before stopping the pod."
fi

echo
echo "============================================"
echo " Kavach-AI is up on RunPod"
echo "============================================"
echo " Frontend UI:  ${FRONTEND_URL}"
echo " Backend API:  ${BACKEND_URL}"
echo " LiteLLM:      ${LITELLM_URL}"
echo "============================================"
echo " Status: supervisorctl -c ${SUPERVISORD_CONF} status"

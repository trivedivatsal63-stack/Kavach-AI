#!/usr/bin/env bash
# Lightweight stack start for pod resume: NO rebuild, NO re-init, NO re-deploy.
#   Stop path:  ./scripts/backup-runpod.sh  →  Stop pod (RunPod console)
#   Start path: Start pod                    →  ./scripts/runpod-start.sh
# Postgres self-heals via runpod-start-postgres.sh (fresh container disk →
# initdb + createdbs + restore /workspace/backups/latest.sql automatically),
# so user data is back without manual steps. Qdrant/HF-cache/venvs live on
# /workspace and need nothing.
# Use runpod-deploy.sh instead for: first install, code changes, .env edits
# affecting DB URLs / master key / VLLM model, frontend rebuilds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

SUPERVISORD_CONF="${REPO_ROOT}/scripts/supervisord.conf"
ENV_FILE="${REPO_ROOT}/.env"
LOG_DIR="${REPO_ROOT}/logs"
mkdir -p "${LOG_DIR}"

is_placeholder() {
  local val="${1:-}"
  case "${val}" in
    ""|change-me*|sk-change-me*) return 0 ;;
    *) return 1 ;;
  esac
}

wait_http() {
  local name="$1" url="$2" timeout_s="$3" elapsed=0
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

echo "==> Repo root: ${REPO_ROOT}"

# 1) Fresh container disk loses /var/lib + /var/run — recreate as root
#    (the postgres wrapper runs as the postgres user and cannot).
mkdir -p /var/lib/postgresql /var/run/postgresql
chown postgres:postgres /var/lib/postgresql /var/run/postgresql

# 2) Secrets + derived backend env (cheap, no rebuild).
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} missing — restore it (off-pod copy) or run runpod-deploy.sh."
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
  exit 1
fi
"${REPO_ROOT}/scripts/sync-backend-env.sh"

# 3) Same daemon-env hygiene as runpod-deploy.sh: unset backend-file-owned
#    keys so `restart backend` later picks up backend/.env edits (dotenv
#    never overrides already-set vars — verified live). DB URLs and master
#    credentials stay exported for supervisord's %(ENV_...)s interpolation.
unset JWT_SECRET CHAT_MODEL RAG_CHAT_MODEL MODEL_MAX_CONTEXT_TOKENS
unset SUPERADMIN_EMAIL CORS_ORIGIN
unset SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS SMTP_FROM SMTP_TLS_INSECURE
export HF_HOME="${HF_HOME:-/workspace/.hf-cache}"

SOCK="${LOG_DIR}/supervisor.sock"
if [[ -S "${SOCK}" ]] && supervisorctl -c "${SUPERVISORD_CONF}" status >/dev/null 2>&1; then
  echo "==> supervisord already running — health summary only (use supervisorctl to restart services)"
else
  echo "==> Starting supervisord (postgres self-heals + restores on fresh disk)"
  supervisord -c "${SUPERVISORD_CONF}"
  sleep 3
fi

# 4) Postgres first: the wrapper may be initdb'ing + restoring a large dump.
echo -n "    waiting for postgres…"
elapsed=0
until /workspace/bin/pg_bin/pg_isready -h 127.0.0.1 -q 2>/dev/null; do
  if (( elapsed >= 600 )); then
    echo
    echo "TIMEOUT: postgres not ready within 600s."
    echo "  Check logs: supervisorctl -c ${SUPERVISORD_CONF} tail postgres"
    exit 1
  fi
  sleep 5
  elapsed=$((elapsed + 5))
  echo -n "."
done
echo " ready (${elapsed}s)"

# 5) Sync role password (dump may carry an older one) then bounce the two
#    pool holders so no stale-password connection pools linger. vLLM keeps
#    loading uninterrupted — no model reload.
echo "==> Syncing Postgres role password"
runuser -u postgres -- /workspace/bin/pg_bin/psql -d postgres -v ON_ERROR_STOP=1 \
  -c "ALTER USER postgres WITH PASSWORD '${POSTGRES_PASSWORD//\'/\'\'}'"
supervisorctl -c "${SUPERVISORD_CONF}" restart backend litellm >/dev/null 2>&1 || true

# 6) Health polls (vLLM reloads weights into GPU on every resume — slowest).
echo "==> Health checks"
FAILED=0
wait_http "qdrant" "http://127.0.0.1:6333/readyz" 120 || FAILED=1
wait_http "embedding" "http://127.0.0.1:8002/health" 300 || FAILED=1
wait_http "vllm" "http://127.0.0.1:8000/health" 1200 || FAILED=1
wait_http "litellm" "http://127.0.0.1:4000/health/readiness" 300 || FAILED=1
wait_http "backend" "http://127.0.0.1:4001/health" 180 || FAILED=1
wait_http "frontend" "http://127.0.0.1:5173" 120 || FAILED=1

if (( FAILED != 0 )); then
  echo
  echo "One or more services failed health checks."
  echo "  supervisorctl -c ${SUPERVISORD_CONF} status"
  exit 1
fi

echo
echo "============================================"
echo " Kavach-AI is up on RunPod"
echo "============================================"
if [[ -n "${RUNPOD_POD_ID:-}" ]]; then
  echo " Frontend UI:  https://${RUNPOD_POD_ID}-5173.proxy.runpod.net"
  echo " Backend API:  https://${RUNPOD_POD_ID}-4001.proxy.runpod.net"
  echo " LiteLLM:      https://${RUNPOD_POD_ID}-4000.proxy.runpod.net"
else
  echo " (RUNPOD_POD_ID not set — see RunPod console for proxy URLs)"
fi
echo "============================================"

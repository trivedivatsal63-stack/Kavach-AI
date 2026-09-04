#!/usr/bin/env bash
# Derive backend/.env from the root .env (single source of truth).
# node reads backend/.env via dotenv at process start; supervisord only
# injects service URLs. Run this after ANY root .env edit, then
# `supervisorctl restart backend` (fast, no vLLM reload — backend reads
# these keys fresh from the file on every start, see runpod-deploy.sh).
# Called automatically by runpod-deploy.sh; safe to run standalone.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

ENV_FILE="${REPO_ROOT}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "${ENV_FILE}"
set +a

# printf (not echo/heredoc) so $/backticks in secrets pass through literally.
{
  printf '%s=%s\n' "DATABASE_URL" "${DATABASE_URL:?DATABASE_URL missing in root .env}"
  printf '%s=%s\n' "JWT_SECRET" "${JWT_SECRET:?JWT_SECRET missing in root .env}"
  printf '%s=%s\n' "LITELLM_BASE_URL" "http://127.0.0.1:4000"
  printf '%s=%s\n' "LITELLM_MASTER_KEY" "${LITELLM_MASTER_KEY:?LITELLM_MASTER_KEY missing in root .env}"
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
  printf '%s=%s\n' "CORS_ORIGIN" "${CORS_ORIGIN:-http://localhost:5173}"
} > "${REPO_ROOT}/backend/.env"
echo "backend/.env synced from root .env"

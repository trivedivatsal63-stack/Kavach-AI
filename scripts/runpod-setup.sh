#!/usr/bin/env bash
# One-time (idempotent) RunPod provisioning for Kavach-AI.
# Runs as root on a CUDA/PyTorch pod template. All persistent state under /workspace.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

EXPECTED_REPO="/workspace/kavach-ai"
if [[ "${REPO_ROOT}" != "${EXPECTED_REPO}" ]]; then
  echo "WARNING: repo is at ${REPO_ROOT}, but supervisord.conf expects ${EXPECTED_REPO}."
  echo "Clone/checkout the repo to ${EXPECTED_REPO} (see scripts/RUNPOD_DEPLOY.md)."
fi

LOG_DIR="${REPO_ROOT}/logs"
mkdir -p /workspace/venvs /workspace/bin /workspace/qdrant/storage /workspace/.hf-cache "${LOG_DIR}"

echo "==> [1/10] System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y \
  postgresql postgresql-contrib \
  python3 python3-venv python3-dev python3-pip \
  build-essential git curl ca-certificates gnupg \
  libxslt1-dev zlib1g-dev libffi-dev libssl-dev \
  supervisor

# Node 20 LTS — backend/frontend have no engines pin; Vite 8 needs Node >= 20.19
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v(2[0-9]|[3-9][0-9])\.'; then
  echo "==> Installing Node.js 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "    node $(node -v) / npm $(npm -v)"

echo "==> [2/10] Postgres cluster under /var/lib/postgresql/pgdata"
PG_VERSION="$(ls /usr/lib/postgresql | sort -V | tail -n1)"
PG_BIN="/usr/lib/postgresql/${PG_VERSION}/bin"
ln -sfn "${PG_BIN}" /workspace/bin/pg_bin
echo "    PostgreSQL ${PG_VERSION} → /workspace/bin/pg_bin"

if [[ ! -f /var/lib/postgresql/pgdata/PG_VERSION ]]; then
  mkdir -p /var/lib/postgresql/pgdata
  chown -R postgres:postgres /var/lib/postgresql/pgdata
  su postgres -c "${PG_BIN}/initdb -D /var/lib/postgresql/pgdata --auth-local=peer --auth-host=scram-sha-256"
  # Allow password auth from localhost (backend / litellm)
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = 5432"
    echo "unix_socket_directories = '/var/run/postgresql'"
  } >> /var/lib/postgresql/pgdata/postgresql.conf
  # Ensure scram for TCP localhost
  if ! grep -qE '^host\s+all\s+all\s+127\.0\.0\.1/32' /var/lib/postgresql/pgdata/pg_hba.conf; then
    echo "host all all 127.0.0.1/32 scram-sha-256" >> /var/lib/postgresql/pgdata/pg_hba.conf
  fi
fi
chown -R postgres:postgres /var/lib/postgresql/pgdata
mkdir -p /var/run/postgresql
chown postgres:postgres /var/run/postgresql

# One-time cluster + databases (password synced later by runpod-deploy.sh
# once .env secrets exist — setup often runs before .env is filled).
if [[ ! -f /var/lib/postgresql/pgdata/.kavach_initialized ]]; then
  echo "    Creating databases (litellm, dashboard) via peer auth…"
  su postgres -c "${PG_BIN}/pg_ctl -D /var/lib/postgresql/pgdata -l ${LOG_DIR}/postgres-init.log start"
  sleep 2

  su postgres -c "${PG_BIN}/psql -d postgres -v ON_ERROR_STOP=1" <<'EOSQL'
SELECT 'CREATE DATABASE litellm OWNER postgres'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'litellm')\gexec
SELECT 'CREATE DATABASE dashboard OWNER postgres'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'dashboard')\gexec
EOSQL

  su postgres -c "${PG_BIN}/pg_ctl -D /var/lib/postgresql/pgdata stop"
  touch /var/lib/postgresql/pgdata/.kavach_initialized
  echo "    Postgres databases ready (password will be set on deploy)."
else
  echo "    Postgres already initialized (skipping)."
fi

echo "==> [3/10] TensorRT-LLM venv (wheels + engine compile happen in runpod-build-trtllm.sh)"
# The AOT compile needs the GPU, ~30–90 min, and a fingerprint cache — it is
# invoked from runpod-deploy.sh / runpod-start-trtllm.sh, not here. This step
# only makes the venv directory so later scripts have a stable path.
mkdir -p /workspace/venvs /workspace/trtllm-engines /workspace/trtllm-ckpts
chmod +x "${REPO_ROOT}/scripts/runpod-build-trtllm.sh" \
         "${REPO_ROOT}/scripts/runpod-start-trtllm.sh" \
         "${REPO_ROOT}/scripts/trtllm_openai_compat.py" 2>/dev/null || true

echo "==> [4/10] LiteLLM venv"
if [[ ! -x /workspace/venvs/litellm/bin/pip ]]; then
  python3 -m venv /workspace/venvs/litellm
fi
/workspace/venvs/litellm/bin/pip install --upgrade pip
# prisma is required when DATABASE_URL / LITELLM_DATABASE_URL is set;
# litellm[proxy] does not always pull it in as a hard dep.
/workspace/venvs/litellm/bin/pip install 'litellm[proxy]' prisma
SCHEMA="$(find /workspace/venvs/litellm -path '*/litellm/proxy/schema.prisma' | head -n1 || true)"
if [[ -n "${SCHEMA}" ]]; then
  # Generate client + create tables in the litellm DB (idempotent).
  /workspace/venvs/litellm/bin/prisma generate --schema="${SCHEMA}" || true
  if [[ -n "${LITELLM_DATABASE_URL:-}" ]]; then
    DATABASE_URL="${LITELLM_DATABASE_URL}" \
      /workspace/venvs/litellm/bin/prisma db push --schema="${SCHEMA}" --accept-data-loss || true
  elif [[ -f "${REPO_ROOT}/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "${REPO_ROOT}/.env"; set +a
    if [[ -n "${LITELLM_DATABASE_URL:-}" ]]; then
      DATABASE_URL="${LITELLM_DATABASE_URL}" \
        /workspace/venvs/litellm/bin/prisma db push --schema="${SCHEMA}" --accept-data-loss || true
    fi
  fi
fi

echo "==> [5/10] Embedding venv"
if [[ ! -x /workspace/venvs/embedding/bin/pip ]]; then
  python3 -m venv /workspace/venvs/embedding
fi
/workspace/venvs/embedding/bin/pip install --upgrade pip
/workspace/venvs/embedding/bin/pip install -r "${REPO_ROOT}/embedding/requirements.txt"
# fastembed + onnxruntime-gpu can leave a broken import namespace
# (AttributeError: SessionOptions). Prefer a single working ORT install.
# With TensorRT-LLM holding most VRAM, CPU ORT is the reliable default;
# EMBEDDING_PROVIDER=auto still tries GPU when enough free VRAM remains.
/workspace/venvs/embedding/bin/pip uninstall -y onnxruntime onnxruntime-gpu 2>/dev/null || true
/workspace/venvs/embedding/bin/pip install --force-reinstall 'onnxruntime>=1.21,<1.27'

echo "==> [6/10] Qdrant binary"
QDRANT_BIN="/workspace/qdrant/qdrant"
if [[ ! -x "${QDRANT_BIN}" ]]; then
  TMP_TGZ="$(mktemp /tmp/qdrant-XXXXXX.tar.gz)"
  # Pin to a known-good release asset name; update when bumping.
  QDRANT_VER="${QDRANT_VER:-v1.18.3}"
  curl -fsSL \
    "https://github.com/qdrant/qdrant/releases/download/${QDRANT_VER}/qdrant-x86_64-unknown-linux-musl.tar.gz" \
    -o "${TMP_TGZ}"
  tar --no-same-owner -xzf "${TMP_TGZ}" -C /workspace/qdrant
  rm -f "${TMP_TGZ}"
  # tarball may unpack as ./qdrant or nested
  if [[ ! -x "${QDRANT_BIN}" ]]; then
    FOUND="$(find /workspace/qdrant -maxdepth 2 -type f -name qdrant | head -n1)"
    if [[ -n "${FOUND}" && "${FOUND}" != "${QDRANT_BIN}" ]]; then
      mv "${FOUND}" "${QDRANT_BIN}"
    fi
  fi
  chmod +x "${QDRANT_BIN}"
fi
mkdir -p /workspace/qdrant/storage

echo "==> [7/10] SearXNG (native venv; no corporate CA injection — RunPod has plain internet)"
if [[ ! -d /workspace/searxng-src/.git ]]; then
  git clone --depth 1 https://github.com/searxng/searxng.git /workspace/searxng-src
fi
if [[ ! -x /workspace/venvs/searxng/bin/pip ]]; then
  python3 -m venv /workspace/venvs/searxng
fi
/workspace/venvs/searxng/bin/pip install --upgrade pip setuptools wheel
# requirements.txt first: -e/--no-build-isolation alone does not reliably
# pull in searx's own runtime deps (confirmed live -- flask itself ended up
# missing entirely, not just one stray package).
# setuptools must be present in the venv: --no-build-isolation skips pip's
# isolated build env, so build_meta has to resolve from site-packages.
/workspace/venvs/searxng/bin/pip install -r /workspace/searxng-src/requirements.txt
/workspace/venvs/searxng/bin/pip install --upgrade setuptools wheel
/workspace/venvs/searxng/bin/pip install --use-pep517 --no-build-isolation -e /workspace/searxng-src
# Optional uwsgi for production-style serving; supervisord uses searx.webapp
# (simpler under process supervision). Install so both paths are available.
/workspace/venvs/searxng/bin/pip install uwsgi || true

# Quick connectivity smoke check (non-fatal)
if curl -fsSL --max-time 10 https://searx.space >/dev/null 2>&1; then
  echo "    Internet/TLS OK from pod (no extra CA needed)."
else
  echo "    WARNING: outbound HTTPS check failed — investigate before relying on live search."
fi

echo "==> [8/10] Backend (npm ci + build)"
cd "${REPO_ROOT}/backend"
npm ci
npm run build

echo "==> [9/10] Frontend (npm ci only — build happens in runpod-deploy.sh)"
cd "${REPO_ROOT}/frontend"
npm ci

echo "==> [10/10] supervisord config"
# apt supervisor looks under /etc/supervisor; we always launch with -c explicitly.
chmod +x "${REPO_ROOT}/scripts/runpod-setup.sh" \
         "${REPO_ROOT}/scripts/runpod-deploy.sh" \
         "${REPO_ROOT}/scripts/runpod-start-vllm.sh" \
         "${REPO_ROOT}/scripts/runpod-build-trtllm.sh" \
         "${REPO_ROOT}/scripts/runpod-start-trtllm.sh" 2>/dev/null || true

echo
echo "Setup complete."
echo "Next: copy .env.runpod.example → .env, fill secrets, then run ./scripts/runpod-deploy.sh"
echo "  (deploy will refuse to continue until secrets are filled in.)"

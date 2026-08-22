#!/usr/bin/env bash
# Fast incremental redeploy: run on the pod, from the repo root, AFTER
# `git pull`. Diffs against the commit recorded from the last redeploy and
# only rebuilds/restarts the services whose files actually changed --
# no need to remember which service needs a build step, which needs the
# special frontend env vars, or which just needs a plain restart.
#
# First run (no marker yet) rebuilds and restarts everything, so it's safe
# to adopt on a pod that's already been deployed by hand.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

MARKER="/workspace/.last-redeploy-commit"
SUPERVISORD_CONF="${REPO_ROOT}/scripts/supervisord.conf"
SCTL="supervisorctl -c ${SUPERVISORD_CONF}"

CURR="$(git rev-parse HEAD)"
PREV=""
[[ -f "${MARKER}" ]] && PREV="$(cat "${MARKER}")"

if [[ -n "${PREV}" && "${PREV}" == "${CURR}" ]]; then
  echo "==> Already up to date at ${CURR:0:8} -- nothing to do."
  exit 0
fi

if [[ -z "${PREV}" ]]; then
  echo "==> No previous redeploy marker -- first run, treating everything as changed."
  # One path per line, matching git diff --name-only's format -- matches()
  # below anchors on line-start, so a single space-separated line here
  # would only ever match its first token.
  CHANGED="$(printf '%s\n' backend/ frontend/ embedding/ litellm/ searxng/ scripts/supervisord.conf scripts/runpod-start-vllm.sh)"
else
  echo "==> Changes since last redeploy (${PREV:0:8} -> ${CURR:0:8}):"
  CHANGED="$(git diff --name-only "${PREV}" "${CURR}")"
  echo "${CHANGED}" | sed 's/^/    /'
fi

matches() { grep -q "^$1" <<<"${CHANGED}"; }

do_backend=false; do_frontend=false; do_embedding=false
do_litellm=false; do_searxng=false; do_vllm=false; do_supervisor_reload=false

matches "backend/" && do_backend=true
matches "frontend/" && do_frontend=true
matches "embedding/" && do_embedding=true
matches "litellm/" && do_litellm=true
matches "searxng/" && do_searxng=true
matches "scripts/runpod-start-vllm.sh" && do_vllm=true
matches "scripts/supervisord.conf" && do_supervisor_reload=true

if ${do_backend}; then
  echo "==> Backend changed -- rebuilding"
  cd "${REPO_ROOT}/backend"
  if matches "backend/package"; then npm ci; fi
  npm run build
  cd "${REPO_ROOT}"
fi

if ${do_frontend}; then
  echo "==> Frontend changed -- rebuilding with baked proxy URLs from .env"
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
  if [[ -z "${VITE_API_BASE_URL:-}" || -z "${VITE_LITELLM_BASE_URL:-}" ]]; then
    echo "    ERROR: VITE_API_BASE_URL / VITE_LITELLM_BASE_URL not set in .env" \
         "(these are normally appended by runpod-deploy.sh on first deploy)." >&2
    exit 1
  fi
  cd "${REPO_ROOT}/frontend"
  if matches "frontend/package"; then npm ci; fi
  VITE_API_BASE_URL="${VITE_API_BASE_URL}" VITE_LITELLM_BASE_URL="${VITE_LITELLM_BASE_URL}" npm run build
  cd "${REPO_ROOT}"
fi

if ${do_supervisor_reload}; then
  echo "==> supervisord.conf changed -- applying"
  ${SCTL} reread
  ${SCTL} update
fi

${do_backend}   && { echo "==> Restarting backend";   ${SCTL} restart backend; }
${do_frontend}  && { echo "==> Restarting frontend";  ${SCTL} restart frontend; }
${do_embedding} && { echo "==> Restarting embedding"; ${SCTL} restart embedding; }
${do_litellm}   && { echo "==> Restarting litellm";   ${SCTL} restart litellm; }
${do_searxng}   && { echo "==> Restarting searxng";   ${SCTL} restart searxng; }
${do_vllm}      && { echo "==> Restarting vllm (model reload -- this one takes a couple minutes)"; ${SCTL} restart vllm; }

echo "${CURR}" > "${MARKER}"
echo "==> Redeploy complete (marker updated to ${CURR:0:8})."
${SCTL} status

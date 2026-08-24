#!/usr/bin/env bash
# Polling fallback for RunPod — runs inside the pod, no GitHub secrets needed.
# Safe to run every 1-2 min; redeploy.sh is no-op when HEAD == last marker.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"
# fetch quiet; if origin/main moved, pull and redeploy
git fetch origin main --quiet 2>/dev/null || exit 0
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
if [[ "${LOCAL}" != "${REMOTE}" ]]; then
  echo "[autopull] ${LOCAL:0:8} -> ${REMOTE:0:8}, pulling"
  git pull --ff-only --quiet
  ./scripts/redeploy.sh
else
  echo "[autopull] up to date at ${LOCAL:0:8}"
fi

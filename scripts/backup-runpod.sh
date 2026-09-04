#!/usr/bin/env bash
# Manual pre-stop backup for Kavach-AI on RunPod.
# Run this BEFORE every pod Stop: the live Postgres cluster is on container
# disk (/workspace is a FUSE mount without chown support, so pgdata cannot
# live there), and only /workspace survives stop/resume. Qdrant storage,
# HF cache, venvs, repo and .env already live on /workspace directly.
# Usage: ./scripts/backup-runpod.sh   (run from the repo root on the pod)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

mkdir -p /workspace/backups

echo "==> Dumping Postgres (all databases + roles)"
TS="$(date +%Y%m%d-%H%M%S)"
if runuser -u postgres -- /workspace/bin/pg_bin/pg_dumpall -f "/workspace/backups/pg-${TS}.sql"; then
  cp -f "/workspace/backups/pg-${TS}.sql" /workspace/backups/latest.sql
  ls -t /workspace/backups/pg-*.sql 2>/dev/null | tail -n +6 | xargs -r rm -f
  echo "    saved /workspace/backups/pg-${TS}.sql (latest.sql refreshed)"
else
  echo "ERROR: pg_dumpall failed — is Postgres running? (supervisorctl status)"
  exit 1
fi

echo "==> Volume state already on /workspace (no action needed):"
echo "    - Qdrant collections : /workspace/qdrant/storage"
echo "    - HF model cache     : /workspace/.hf-cache"
echo "    - Secrets            : ${REPO_ROOT}/.env  (copy off-pod as well!)"
echo
echo "Backup complete. Safe to Stop the pod. On resume/recreate, run"
echo "runpod-setup.sh (auto-restores latest.sql) then runpod-deploy.sh."

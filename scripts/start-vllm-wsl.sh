#!/usr/bin/env bash
# Optional: run vLLM in WSL without Docker.
# Preferred path for this repo is: docker compose up -d  (vLLM + LiteLLM).
# Keep this script for debugging / bare-metal WSL runs.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

MODEL="${VLLM_MODEL:-Qwen/Qwen2.5-1.5B-Instruct-AWQ}"
SERVED="${VLLM_SERVED_NAME:-qwen2.5-1.5b}"
UTIL="${VLLM_GPU_MEMORY_UTILIZATION:-0.70}"
MAX_LEN="${VLLM_MAX_MODEL_LEN:-2048}"
MAX_SEQS="${VLLM_MAX_NUM_SEQS:-4}"
PORT="${VLLM_PORT:-8000}"

export VLLM_WSL2_ENABLE_PIN_MEMORY=1

echo "NOTE: Preferred stack uses Docker (docker compose up -d)."
echo "GPU profile RTX 2050 — model=$MODEL util=$UTIL max_len=$MAX_LEN"

ARGS=(
  --model "$MODEL"
  --served-model-name "$SERVED"
  --gpu-memory-utilization "$UTIL"
  --max-model-len "$MAX_LEN"
  --max-num-seqs "$MAX_SEQS"
  --host 0.0.0.0
  --port "$PORT"
  --dtype auto
)

if [[ "${VLLM_ENFORCE_EAGER:-1}" == "1" ]]; then
  ARGS+=(--enforce-eager)
fi

exec python -m vllm.entrypoints.openai.api_server "${ARGS[@]}"

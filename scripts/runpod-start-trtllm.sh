#!/usr/bin/env bash
# Supervisord entrypoint: TensorRT-LLM OpenAI server on :8000.
#
# Replaces scripts/runpod-start-vllm.sh. LiteLLM (openai/ provider) and the
# backend RAG tokenizer keep talking to 127.0.0.1:8000 — this wrapper:
#   1. compiles the engine if the fingerprint is missing (runpod-build-trtllm.sh)
#   2. starts trtllm-serve on 127.0.0.1:8011 against the compiled engine
#      (8001 is occupied by RunPod's host nginx — do not reuse it)
#   3. fronts it with trtllm_openai_compat.py on 0.0.0.0:8000 so that
#      POST /v1/chat/completions (LiteLLM) and POST /tokenize (backend) both work
set -euo pipefail

log() { printf '[trtllm-serve] %s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { printf '[trtllm-serve] ERROR: %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

TRT_MODEL="${TRT_MODEL:?TRT_MODEL is required}"
TRT_SERVED_NAME="${TRT_SERVED_NAME:-gemma-4-26b-a4b}"
TRT_MAX_MODEL_LEN="${TRT_MAX_MODEL_LEN:-8192}"
TRT_MAX_NUM_SEQS="${TRT_MAX_NUM_SEQS:-16}"
TRT_QUANTIZATION="${TRT_QUANTIZATION:-int4_awq}"
TRT_GPU_MEMORY_UTILIZATION="${TRT_GPU_MEMORY_UTILIZATION:-0.65}"
TRT_MAX_NUM_TOKENS="${TRT_MAX_NUM_TOKENS:-16384}"
TRT_KV_CACHE_DTYPE="${TRT_KV_CACHE_DTYPE:-auto}"
TRT_BACKEND="${TRT_BACKEND:-pytorch}"
# cyankiwi Gemma 4 26B-A4B QAT-AWQ-INT4 card size; override if you swap packs.
TRT_WEIGHTS_GB="${TRT_WEIGHTS_GB:-17.19}"
EMBEDDING_GPU_MIN_FREE_MB="${EMBEDDING_GPU_MIN_FREE_MB:-2048}"
export TRT_MODEL TRT_SERVED_NAME TRT_MAX_MODEL_LEN TRT_MAX_NUM_SEQS
export TRT_QUANTIZATION TRT_GPU_MEMORY_UTILIZATION TRT_MAX_NUM_TOKENS
export TRT_KV_CACHE_DTYPE TRT_BACKEND TRT_WEIGHTS_GB EMBEDDING_GPU_MIN_FREE_MB

TRTLLM_VENV="${TRTLLM_VENV:-/workspace/venvs/trtllm}"
HF_HOME="${HF_HOME:-/workspace/.hf-cache}"
export HF_HOME HUGGING_FACE_HUB_TOKEN="${HUGGING_FACE_HUB_TOKEN:-}"
export PATH="${TRTLLM_VENV}/bin:${PATH}"

MODEL_SLUG="$(printf '%s' "${TRT_MODEL}" | tr '/:' '__' | tr -c 'A-Za-z0-9._-' '_')"
ENGINE_DIR="${TRT_ENGINE_DIR:-/workspace/trtllm-engines/${MODEL_SLUG}-sm86-${TRT_QUANTIZATION}-len${TRT_MAX_MODEL_LEN}-bs${TRT_MAX_NUM_SEQS}}"
TOKENIZER_DIR="${TRT_TOKENIZER_DIR:-${ENGINE_DIR}/tokenizer}"
if [[ ! -d "${TOKENIZER_DIR}" ]]; then
  TOKENIZER_DIR="${TRT_HF_DIR:-/workspace/hf-models/${MODEL_SLUG}}"
fi

PUBLIC_HOST="${TRT_BIND_HOST:-0.0.0.0}"
PUBLIC_PORT="${TRT_PORT:-8000}"
UPSTREAM_HOST="127.0.0.1"
UPSTREAM_PORT="${TRT_UPSTREAM_PORT:-8011}"
EXTRA_YAML="${ENGINE_DIR}/serve-extra.yaml"

# ── compile / fetch on first boot ──────────────────────────────────────────
if [[ ! -f "${ENGINE_DIR}/engine.meta.json" ]]; then
  log "no checkpoint fingerprint at ${ENGINE_DIR} — running prepare/compile"
  "${SCRIPT_DIR}/runpod-build-trtllm.sh"
fi
[[ -x "${TRTLLM_VENV}/bin/trtllm-serve" ]] || die "trtllm-serve missing in ${TRTLLM_VENV}"

if [[ -f "${ENGINE_DIR}/pytorch.ready" ]]; then
  SERVE_TARGET="${ENGINE_DIR}/hf"
  [[ -d "${SERVE_TARGET}" ]] || SERVE_TARGET="${TOKENIZER_DIR}"
  [[ -d "${SERVE_TARGET}" ]] || SERVE_TARGET="${TRT_MODEL}"
  SERVE_BACKEND="pytorch"
  log "PyTorch backend — serving HF checkpoint ${SERVE_TARGET}"
else
  [[ -f "${ENGINE_DIR}/config.json" ]] || die "engine dir ${ENGINE_DIR} is incomplete after build"
  compgen -G "${ENGINE_DIR}/*.engine" >/dev/null || die "no .engine file in ${ENGINE_DIR} (and no pytorch.ready). Gemma 4 must be TRT_BACKEND=pytorch."
  SERVE_TARGET="${ENGINE_DIR}"
  SERVE_BACKEND="tensorrt"
  log "TensorRT engine — serving ${ENGINE_DIR}"
fi

# ── KV-cache fraction: 0.65 total-VRAM floor minus embedding reserve ───────
# trtllm-serve's kv_cache_free_gpu_memory_fraction is *of memory left after
# weights*. Convert the platform 0.65 total-VRAM cap into that unit so the
# embedding process still sees EMBEDDING_GPU_MIN_FREE_MB free.
KV_FRACTION="$(
  "${TRTLLM_VENV}/bin/python" - <<'PY'
import os
util = float(os.environ.get("TRT_GPU_MEMORY_UTILIZATION", "0.65"))
reserve_mb = float(os.environ.get("EMBEDDING_GPU_MIN_FREE_MB", "2048"))
weights_gb = float(os.environ.get("TRT_WEIGHTS_GB", "17.19"))
weights_mb = weights_gb * 1024.0
try:
    import pynvml
    pynvml.nvmlInit()
    h = pynvml.nvmlDeviceGetHandleByIndex(0)
    total = pynvml.nvmlDeviceGetMemoryInfo(h).total / (1024 * 1024)
except Exception:
    total = 49140.0  # RTX A6000 fallback
# After weights load, remaining VRAM feeds the paged KV pool. Cap that pool so
# (weights + KV) stays under util*total and still leaves embedding headroom.
remaining = max(total - weights_mb, 1024.0)
target_total = min(util * total, total - reserve_mb)
kv_mb = max(target_total - weights_mb, 1024.0)
frac = max(0.20, min(0.90, kv_mb / remaining))
print(f"{frac:.3f}")
PY
)"
log "kv_cache_free_gpu_memory_fraction=${KV_FRACTION} (weights=${TRT_WEIGHTS_GB}GB util=${TRT_GPU_MEMORY_UTILIZATION} embed_reserve=${EMBEDDING_GPU_MIN_FREE_MB}MiB)"

mkdir -p "${ENGINE_DIR}"
cat > "${EXTRA_YAML}" <<YAML
# Generated by runpod-start-trtllm.sh — do not edit by hand.
enable_chunked_prefill: true
max_batch_size: ${TRT_MAX_NUM_SEQS}
max_num_tokens: ${TRT_MAX_NUM_TOKENS}
max_seq_len: ${TRT_MAX_MODEL_LEN}
kv_cache_config:
  enable_block_reuse: true
  free_gpu_memory_fraction: ${KV_FRACTION}
  dtype: ${TRT_KV_CACHE_DTYPE}
scheduler_config:
  enable_chunked_context: true
# FLASHINFER cubins are Hopper/Ada; Gemma 4 on Ampere SM 86 must not auto-pick them.
attn_backend: TRITON
YAML

# ── process tree ───────────────────────────────────────────────────────────
SERVE_PID=""
COMPAT_PID=""
cleanup() {
  local code=$?
  log "shutting down (exit ${code})"
  if [[ -n "${COMPAT_PID}" ]] && kill -0 "${COMPAT_PID}" 2>/dev/null; then
    kill "${COMPAT_PID}" 2>/dev/null || true
  fi
  if [[ -n "${SERVE_PID}" ]] && kill -0 "${SERVE_PID}" 2>/dev/null; then
    kill "${SERVE_PID}" 2>/dev/null || true
    wait "${SERVE_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

log "starting trtllm-serve on ${UPSTREAM_HOST}:${UPSTREAM_PORT} target=${SERVE_TARGET} backend=${SERVE_BACKEND}"
SERVE_HELP="$("${TRTLLM_VENV}/bin/trtllm-serve" --help 2>/dev/null || true)"
SERVE_CMD=(
  "${TRTLLM_VENV}/bin/trtllm-serve" "${SERVE_TARGET}"
  --tokenizer "${TOKENIZER_DIR}"
  --host "${UPSTREAM_HOST}"
  --port "${UPSTREAM_PORT}"
  --max_batch_size "${TRT_MAX_NUM_SEQS}"
  --max_num_tokens "${TRT_MAX_NUM_TOKENS}"
  --max_seq_len "${TRT_MAX_MODEL_LEN}"
  --kv_cache_free_gpu_memory_fraction "${KV_FRACTION}"
)
if grep -q -- '--served_model_name' <<<"${SERVE_HELP}"; then
  SERVE_CMD+=(--served_model_name "${TRT_SERVED_NAME}")
fi
if grep -q -- '--enable_chunked_prefill' <<<"${SERVE_HELP}"; then
  SERVE_CMD+=(--enable_chunked_prefill)
fi
if grep -q -- '--extra_llm_api_options' <<<"${SERVE_HELP}"; then
  SERVE_CMD+=(--extra_llm_api_options "${EXTRA_YAML}")
elif grep -q -- '--config' <<<"${SERVE_HELP}"; then
  SERVE_CMD+=(--config "${EXTRA_YAML}")
fi
if grep -q -- '--backend' <<<"${SERVE_HELP}"; then
  SERVE_CMD+=(--backend "${SERVE_BACKEND}")
fi
if [[ "${SERVE_BACKEND}" == "pytorch" ]]; then
  if grep -q -- '--reasoning_parser' <<<"${SERVE_HELP}"; then
    SERVE_CMD+=(--reasoning_parser gemma4)
  fi
  if grep -q -- '--tool_parser' <<<"${SERVE_HELP}"; then
    SERVE_CMD+=(--tool_parser gemma4)
  fi
fi

"${SERVE_CMD[@]}" &
SERVE_PID=$!

log "waiting for trtllm-serve health on :${UPSTREAM_PORT}"
elapsed=0
# Gemma 4 26B MoE AWQ first load on Ampere can exceed 15–20 min (weights + compile).
HEALTH_TIMEOUT_S="${TRT_HEALTH_TIMEOUT_S:-2400}"
health_ok() {
  local base="http://${UPSTREAM_HOST}:${UPSTREAM_PORT}"
  curl -fsS --max-time 2 "${base}/health" >/dev/null 2>&1 \
    || curl -fsS --max-time 2 "${base}/v1/models" >/dev/null 2>&1 \
    || curl -fsS --max-time 2 "${base}/health/ready" >/dev/null 2>&1
}
until health_ok; do
  if ! kill -0 "${SERVE_PID}" 2>/dev/null; then
    die "trtllm-serve exited before becoming healthy (pid ${SERVE_PID}). Check logs/trtllm.err.log"
  fi
  sleep 5
  elapsed=$((elapsed + 5))
  if (( elapsed > HEALTH_TIMEOUT_S )); then
    die "trtllm-serve did not become healthy within ${HEALTH_TIMEOUT_S}s"
  fi
  if (( elapsed % 60 == 0 )); then
    log "  still waiting (${elapsed}s / ${HEALTH_TIMEOUT_S}s)…"
  fi
done
log "trtllm-serve healthy after ${elapsed}s"

log "starting OpenAI + /tokenize front door on ${PUBLIC_HOST}:${PUBLIC_PORT}"
"${TRTLLM_VENV}/bin/python" "${SCRIPT_DIR}/trtllm_openai_compat.py" \
  --host "${PUBLIC_HOST}" \
  --port "${PUBLIC_PORT}" \
  --upstream "http://${UPSTREAM_HOST}:${UPSTREAM_PORT}" \
  --tokenizer "${TOKENIZER_DIR}" \
  --served-model-name "${TRT_SERVED_NAME}" \
  --max-model-len "${TRT_MAX_MODEL_LEN}" &
COMPAT_PID=$!

# Block here so supervisord tracks this script as the service PID.
wait "${COMPAT_PID}"

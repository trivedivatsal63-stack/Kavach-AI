#!/usr/bin/env bash
# Ahead-of-time TensorRT-LLM engine compile for the RunPod host (native, no Docker).
#
# Target: single NVIDIA RTX A6000 (Ampere GA102, SM 86, 48 GB).
# Output: one rank0.engine + config.json under TRT_ENGINE_DIR, reused on restart
# unless the fingerprint (model / quant / lens / SM / TRT-LLM version) changes.
#
# Required env (defaults match .env.runpod.example):
#   TRT_MODEL, TRT_MAX_MODEL_LEN, TRT_MAX_NUM_SEQS, TRT_QUANTIZATION
#
# Optional:
#   TRT_FORCE_REBUILD=1          ignore a matching cached engine
#   TRTLLM_VERSION               pin the wheel (must still ship trtllm-build)
#   TRT_GPU_MEMORY_UTILIZATION   total-VRAM cap used for preflight (default 0.65)
#   EMBEDDING_GPU_MIN_FREE_MB    reserved for the embedding service (default 2048)
set -euo pipefail

log()  { printf '[trtllm-build] %s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die()  { printf '[trtllm-build] ERROR: %s\n' "$*" >&2; exit 1; }
warn() { printf '[trtllm-build] WARN:  %s\n' "$*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

# ── knobs ──────────────────────────────────────────────────────────────────
TRT_MODEL="${TRT_MODEL:?TRT_MODEL is required (Hugging Face id or local path)}"
TRT_MAX_MODEL_LEN="${TRT_MAX_MODEL_LEN:-8192}"
TRT_MAX_NUM_SEQS="${TRT_MAX_NUM_SEQS:-16}"
TRT_QUANTIZATION="${TRT_QUANTIZATION:-int4_awq}"
TRT_SERVED_NAME="${TRT_SERVED_NAME:-gemma-4-26b-a4b}"
TRT_DTYPE="${TRT_DTYPE:-float16}"
TRT_KV_CACHE_DTYPE="${TRT_KV_CACHE_DTYPE:-auto}"   # auto → fp16 on Ampere W4A16
TRT_GPU_MEMORY_UTILIZATION="${TRT_GPU_MEMORY_UTILIZATION:-0.65}"
TRT_MAX_NUM_TOKENS="${TRT_MAX_NUM_TOKENS:-16384}"
TRT_TOKENS_PER_BLOCK="${TRT_TOKENS_PER_BLOCK:-64}"
TRT_FORCE_REBUILD="${TRT_FORCE_REBUILD:-0}"
TRT_WEIGHTS_GB="${TRT_WEIGHTS_GB:-17.19}"
# pytorch = Gemma 4 MoE path (HF AWQ checkpoint → trtllm-serve, no .engine).
# tensorrt = legacy convert_checkpoint + trtllm-build (Qwen/Llama/Mixtral only).
TRT_BACKEND="${TRT_BACKEND:-pytorch}"
EMBEDDING_GPU_MIN_FREE_MB="${EMBEDDING_GPU_MIN_FREE_MB:-2048}"

# Gemma 4 needs the 1.3.0rc line (stable 1.2.1 does not include it).
# 1.3+ dropped trtllm-build — that is expected when TRT_BACKEND=pytorch.
# PyPI skip: rc16/rc17 were never published; use rc24 (or rc15 minimum for Gemma 4).
TRTLLM_VERSION="${TRTLLM_VERSION:-1.3.0rc24}"
TRTLLM_VENV="${TRTLLM_VENV:-/workspace/venvs/trtllm}"
TRTLLM_SRC="${TRTLLM_SRC:-/workspace/src/TensorRT-LLM}"
HF_HOME="${HF_HOME:-/workspace/.hf-cache}"
export HF_HOME HUGGING_FACE_HUB_TOKEN="${HUGGING_FACE_HUB_TOKEN:-}"
export TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST:-8.6}"
export CMAKE_CUDA_ARCHITECTURES="${CMAKE_CUDA_ARCHITECTURES:-86}"

MODEL_SLUG="$(printf '%s' "${TRT_MODEL}" | tr '/:' '__' | tr -c 'A-Za-z0-9._-' '_')"
ENGINE_ROOT="${TRT_ENGINE_ROOT:-/workspace/trtllm-engines}"
CKPT_ROOT="${TRT_CKPT_ROOT:-/workspace/trtllm-ckpts}"
HF_DIR="${TRT_HF_DIR:-/workspace/hf-models/${MODEL_SLUG}}"
ENGINE_DIR="${TRT_ENGINE_DIR:-${ENGINE_ROOT}/${MODEL_SLUG}-sm86-${TRT_QUANTIZATION}-len${TRT_MAX_MODEL_LEN}-bs${TRT_MAX_NUM_SEQS}}"
CKPT_DIR="${CKPT_ROOT}/${MODEL_SLUG}-${TRT_QUANTIZATION}"
META_FILE="${ENGINE_DIR}/engine.meta.json"

mkdir -p "${ENGINE_ROOT}" "${CKPT_ROOT}" "${HF_DIR}" "${HF_HOME}" "$(dirname "${TRTLLM_VENV}")"

engine_present() {
  local dir="${1:-${ENGINE_DIR}}"
  [[ -f "${dir}/config.json" ]] || return 1
  compgen -G "${dir}/*.engine" >/dev/null 2>&1
}

checkpoint_ready() {
  local dir="${1:-${ENGINE_DIR}}"
  [[ -f "${dir}/pytorch.ready" && -f "${dir}/engine.meta.json" ]] && return 0
  engine_present "${dir}"
}

# Fast path: skip apt/pip/compile when the on-disk engine already matches this
# config AND the serve binary is present. Deploy calls this script on every bring-up.
if [[ "${TRT_FORCE_REBUILD}" != "1" ]] \
  && checkpoint_ready "${ENGINE_DIR}" \
  && [[ -f "${META_FILE}" ]] \
  && [[ -x "${TRTLLM_VENV}/bin/trtllm-serve" ]]; then
  if python3 - "${META_FILE}" "${TRT_MODEL}" "${TRT_QUANTIZATION}" "${TRT_MAX_MODEL_LEN}" "${TRT_MAX_NUM_SEQS}" "${TRTLLM_VERSION}" <<'PY'
import json, sys
meta = json.load(open(sys.argv[1]))
expect = {
    "model": sys.argv[2],
    "quantization": sys.argv[3],
    "max_model_len": int(sys.argv[4]),
    "max_num_seqs": int(sys.argv[5]),
    "sm": "86",
    "trtllm_version": sys.argv[6],
}
sys.exit(0 if all(meta.get(k) == v for k, v in expect.items()) else 1)
PY
  then
    log "cached engine matches fingerprint — skipping compile"
    log "  engine: ${ENGINE_DIR}"
    exit 0
  fi
  warn "cached engine fingerprint mismatch — will rebuild"
fi

# ── helpers ────────────────────────────────────────────────────────────────
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

trt_python() { "${TRTLLM_VENV}/bin/python"; }

gpu_probe() {
  "${TRTLLM_VENV}/bin/python" - <<'PY'
import json, sys
try:
    import pynvml
except ImportError:
    print(json.dumps({"ok": False, "error": "pynvml not installed"}))
    sys.exit(2)
pynvml.nvmlInit()
if pynvml.nvmlDeviceGetCount() < 1:
    print(json.dumps({"ok": False, "error": "no NVIDIA GPU visible"}))
    sys.exit(2)
h = pynvml.nvmlDeviceGetHandleByIndex(0)
name = pynvml.nvmlDeviceGetName(h)
if isinstance(name, bytes):
    name = name.decode()
major, minor = pynvml.nvmlDeviceGetCudaComputeCapability(h)
mem = pynvml.nvmlDeviceGetMemoryInfo(h)
print(json.dumps({
    "ok": True,
    "name": name,
    "sm": f"{major}{minor}",
    "cc": f"{major}.{minor}",
    "total_mb": int(mem.total / 1024 / 1024),
    "free_mb": int(mem.free / 1024 / 1024),
    "used_mb": int(mem.used / 1024 / 1024),
}))
PY
}

host_ram_mb() {
  awk '/^MemAvailable:/ {print int($2/1024); exit}' /proc/meminfo
}

fingerprint_json() {
  "${TRTLLM_VENV}/bin/python" - <<PY
import json, importlib.metadata, sys
try:
    ver = importlib.metadata.version("tensorrt_llm")
except Exception:
    ver = "${TRTLLM_VERSION}"
print(json.dumps({
    "model": "${TRT_MODEL}",
    "weights_gb": float("${TRT_WEIGHTS_GB}"),
    "backend": "${TRT_BACKEND}",
    "quantization": "${TRT_QUANTIZATION}",
    "dtype": "${TRT_DTYPE}",
    "kv_cache_dtype": "${TRT_KV_CACHE_DTYPE}",
    "max_model_len": int("${TRT_MAX_MODEL_LEN}"),
    "max_num_seqs": int("${TRT_MAX_NUM_SEQS}"),
    "max_num_tokens": int("${TRT_MAX_NUM_TOKENS}"),
    "tokens_per_block": int("${TRT_TOKENS_PER_BLOCK}"),
    "sm": "86",
    "trtllm_version": ver,
}, indent=2, sort_keys=True))
PY
}

# ── 1. system packages ─────────────────────────────────────────────────────
log "installing compilation tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -qq
apt-get install -y -qq \
  build-essential cmake ninja-build git git-lfs python3 python3-venv python3-dev python3-pip \
  libopenmpi-dev openmpi-bin \
  curl ca-certificates pkg-config \
  >/dev/null
git lfs install --skip-repo >/dev/null 2>&1 || true

require_cmd nvidia-smi
require_cmd python3

# ── 2. venv + wheels ───────────────────────────────────────────────────────
if [[ ! -x "${TRTLLM_VENV}/bin/pip" ]]; then
  log "creating venv at ${TRTLLM_VENV}"
  python3 -m venv "${TRTLLM_VENV}"
fi
# shellcheck disable=SC1091
source "${TRTLLM_VENV}/bin/activate"
# Pin setuptools<80: tensorrt_llm/torch require it. Bare `setuptools` upgrades
# to 84+ every run and forces a slow pip resolve on every deploy.
python -m pip install --upgrade pip 'setuptools>=70,<80' wheel >/dev/null

log "installing tensorrt_llm==${TRTLLM_VERSION} + build deps"
install_trtllm() {
  python -m pip install --upgrade \
    "tensorrt_llm==${1}" \
    tensorrt \
    pynvml \
    "transformers>=4.43.0" \
    "huggingface_hub[cli]" \
    nvidia-ml-py \
    "nvidia-modelopt[hf]" \
    sentencepiece \
    protobuf \
    fastapi \
    uvicorn \
    httpx
}
if ! install_trtllm "${TRTLLM_VERSION}"; then
  if [[ "${TRT_BACKEND}" == "pytorch" ]]; then
    for cand in 1.3.0rc24 1.3.0rc23 1.3.0rc22 1.3.0rc15; do
      [[ "${cand}" == "${TRTLLM_VERSION}" ]] && continue
      warn "tensorrt_llm==${TRTLLM_VERSION} failed — trying ${cand}"
      TRTLLM_VERSION="${cand}"
      if install_trtllm "${TRTLLM_VERSION}"; then
        break
      fi
    done
    command -v trtllm-serve >/dev/null 2>&1 \
      || die "could not install a Gemma-4-capable tensorrt_llm (need 1.3.0rc15+). Unpinned pip can land on 1.2.1 which has no Gemma 4."
  else
    warn "tensorrt_llm==${TRTLLM_VERSION} failed — falling back to 0.21.0"
    TRTLLM_VERSION="0.21.0"
    install_trtllm "${TRTLLM_VERSION}"
  fi
fi

command -v trtllm-serve >/dev/null 2>&1 \
  || die "trtllm-serve not on PATH after install (tensorrt_llm==${TRTLLM_VERSION})."
if [[ "${TRT_BACKEND}" == "tensorrt" ]]; then
  command -v trtllm-build >/dev/null 2>&1 \
    || die "trtllm-build missing. Gemma 4 uses TRT_BACKEND=pytorch (no engine compile). For Qwen/Llama AOT set TRTLLM_VERSION=1.0.0 and TRT_BACKEND=tensorrt."
fi

log "tensorrt_llm $(python -c 'import importlib.metadata as m; print(m.version("tensorrt_llm"))')"

# ── 3. GPU / VRAM / SM 86 validation ───────────────────────────────────────
GPU_JSON="$(gpu_probe)" || die "GPU probe failed: ${GPU_JSON:-no output}"
log "GPU probe: ${GPU_JSON}"

SM="$(python -c "import json; print(json.loads('''${GPU_JSON}''')['sm'])")"
CC="$(python -c "import json; print(json.loads('''${GPU_JSON}''')['cc'])")"
GPU_NAME="$(python -c "import json; print(json.loads('''${GPU_JSON}''')['name'])")"
TOTAL_MB="$(python -c "import json; print(json.loads('''${GPU_JSON}''')['total_mb'])")"
FREE_MB="$(python -c "import json; print(json.loads('''${GPU_JSON}''')['free_mb'])")"

if [[ "${SM}" != "86" ]]; then
  die "expected Ampere SM 86 (RTX A6000), found SM ${SM} (${GPU_NAME}, cc ${CC}). Engines are GPU-architecture specific — rebuild on the target SKU."
fi
log "Ampere SM 86 confirmed (${GPU_NAME})"

# 30B-class W4A16 weights ~16-24 GB; engine build peaks higher. Floor: 36 GB total.
if (( TOTAL_MB < 36000 )); then
  die "GPU has ${TOTAL_MB} MiB total VRAM; a 30B AWQ engine needs an A6000-class 48 GB card."
fi

# Keep the 0.65 allocation floor so the embedding service still has headroom.
UTIL_MB="$(python -c "print(int(${TOTAL_MB} * float('${TRT_GPU_MEMORY_UTILIZATION}')))")"
RESERVE_MB="${EMBEDDING_GPU_MIN_FREE_MB}"
NEED_FREE_MB=8192
if (( FREE_MB < NEED_FREE_MB )); then
  die "only ${FREE_MB} MiB free VRAM (need ≥ ${NEED_FREE_MB} MiB to compile). Stop other GPU processes (vLLM leftovers, notebooks) and retry."
fi
log "VRAM ${FREE_MB}/${TOTAL_MB} MiB free; util cap ${TRT_GPU_MEMORY_UTILIZATION} → ${UTIL_MB} MiB; embedding reserve ${RESERVE_MB} MiB"

RAM_MB="$(host_ram_mb || echo 0)"
if (( RAM_MB < 24000 )); then
  warn "only ${RAM_MB} MiB host RAM available — 30B checkpoint conversion can OOM. Consider a higher-RAM pod."
else
  log "host RAM available: ${RAM_MB} MiB"
fi

# ── 4. skip compile if fingerprint matches ─────────────────────────────────
FINGERPRINT="$(fingerprint_json)"
if [[ "${TRT_FORCE_REBUILD}" != "1" ]] && checkpoint_ready "${ENGINE_DIR}" && [[ -f "${META_FILE}" ]]; then
  if python -c "import json,sys; a=json.load(open('${META_FILE}')); b=json.loads(sys.argv[1]); sys.exit(0 if a==b else 1)" "${FINGERPRINT}"; then
    log "cached checkpoint matches fingerprint — skipping compile"
    log "  dir: ${ENGINE_DIR}"
    exit 0
  fi
  warn "cached checkpoint fingerprint mismatch — rebuilding"
fi
if [[ "${TRT_FORCE_REBUILD}" == "1" ]]; then
  log "TRT_FORCE_REBUILD=1 — ignoring cached checkpoint"
fi

# ── 5. examples checkout (convert_checkpoint / quantize.py) ────────────────
if [[ "${TRT_BACKEND}" != "pytorch" ]]; then
  if [[ ! -d "${TRTLLM_SRC}/.git" ]]; then
    log "cloning TensorRT-LLM v${TRTLLM_VERSION} examples into ${TRTLLM_SRC}"
    mkdir -p "$(dirname "${TRTLLM_SRC}")"
    git clone --depth 1 --branch "v${TRTLLM_VERSION}" \
      https://github.com/NVIDIA/TensorRT-LLM.git "${TRTLLM_SRC}" \
      || git clone --depth 1 https://github.com/NVIDIA/TensorRT-LLM.git "${TRTLLM_SRC}"
  else
    log "TensorRT-LLM sources already at ${TRTLLM_SRC}"
  fi
fi

find_script() {
  local name="$1"
  local family="${2:-}"
  local candidates=()
  if [[ -n "${family}" ]]; then
    candidates+=(
      "${TRTLLM_SRC}/examples/models/core/${family}/${name}"
      "${TRTLLM_SRC}/examples/${family}/${name}"
    )
  fi
  candidates+=(
    "${TRTLLM_SRC}/examples/quantization/${name}"
    "${TRTLLM_SRC}/examples/models/core/qwen/${name}"
    "${TRTLLM_SRC}/examples/qwen/${name}"
    "${TRTLLM_SRC}/examples/llama/${name}"
    "${TRTLLM_SRC}/examples/mixtral/${name}"
    "${TRTLLM_SRC}/examples/gemma/${name}"
  )
  local p
  for p in "${candidates[@]}"; do
    [[ -f "${p}" ]] && { printf '%s' "${p}"; return 0; }
  done
  return 1
}

# ── 6. pull Hugging Face weights ───────────────────────────────────────────
log "fetching weights: ${TRT_MODEL} → ${HF_DIR}"
if [[ -d "${TRT_MODEL}" && -f "${TRT_MODEL}/config.json" ]]; then
  HF_DIR="${TRT_MODEL}"
  log "TRT_MODEL is a local checkpoint (${HF_DIR})"
elif [[ -f "${HF_DIR}/config.json" ]]; then
  log "weights already present at ${HF_DIR} - skipping download"
else
  # Use snapshot_download (not `hf` / `huggingface-cli`):
  # - huggingface-cli is a dead stub on hub 1.16+
  # - `hf download` can finish the files then raise click.Exit(0) with a
  #   traceback; under set -e that aborts the build even though weights are OK
  log "downloading via huggingface_hub.snapshot_download"
  "${TRTLLM_VENV}/bin/python" - "${TRT_MODEL}" "${HF_DIR}" "${HUGGING_FACE_HUB_TOKEN:-}" <<'PY'
import sys
from huggingface_hub import snapshot_download
model, dest, token = sys.argv[1], sys.argv[2], sys.argv[3] or None
snapshot_download(repo_id=model, local_dir=dest, token=token or None)
print("downloaded", model, "->", dest)
PY
fi
[[ -f "${HF_DIR}/config.json" ]] || die "no config.json under ${HF_DIR} - download failed"

MODEL_TYPE="$(
  python - "${HF_DIR}" <<'PY'
import json, sys
print(json.load(open(sys.argv[1] + "/config.json")).get("model_type", "").lower())
PY
)"
ARCH="$(
  python - "${HF_DIR}" <<'PY'
import json, sys
a = json.load(open(sys.argv[1] + "/config.json")).get("architectures") or [""]
print(a[0])
PY
)"
QUANT_METHOD="$(
  python - "${HF_DIR}" <<'PY'
import json, sys
c = json.load(open(sys.argv[1] + "/config.json"))
q = c.get("quantization_config") or {}
print((q.get("quant_method") or "").lower())
PY
)"
log "HF model_type=${MODEL_TYPE} arch=${ARCH} quant_method=${QUANT_METHOD:-none}"

is_gemma4=0
case "${MODEL_TYPE}" in
  gemma4|gemma4_moe|gemma4_text) is_gemma4=1 ;;
esac
case "${ARCH}" in
  Gemma4*|Gemma4For*) is_gemma4=1 ;;
esac

# Gemma 4 has no convert_checkpoint / trtllm-build path. Official serve is
# PyTorch-backend trtllm-serve on the HF checkpoint (NVIDIA docs, Aug 2026).
if [[ "${TRT_BACKEND}" == "pytorch" || "${is_gemma4}" -eq 1 ]]; then
  if [[ "${is_gemma4}" -eq 1 && "${TRT_QUANTIZATION}" == "int4_awq" && -z "${QUANT_METHOD}" ]]; then
    warn "Gemma 4 BF16 weights (~50 GB) will not fit an A6000 48 GB card. Use an AWQ/INT4 checkpoint (e.g. cyankiwi/gemma-4-26B-A4B-it-qat-AWQ-INT4) or a ModelOpt W4A16 export."
  fi
  log "PyTorch-backend checkpoint ready (no TensorRT engine compile)"
  rm -rf "${ENGINE_DIR}"
  mkdir -p "${ENGINE_DIR}"
  ln -sfn "${HF_DIR}" "${ENGINE_DIR}/tokenizer"
  ln -sfn "${HF_DIR}" "${ENGINE_DIR}/hf"
  printf '%s\n' "${FINGERPRINT}" > "${META_FILE}"
  printf 'backend=pytorch\nmodel=%s\n' "${TRT_MODEL}" > "${ENGINE_DIR}/pytorch.ready"
  # config.json so health/start scripts can treat this like an engine dir
  cp -f "${HF_DIR}/config.json" "${ENGINE_DIR}/config.json"
  log "serve target: ${HF_DIR}"
  log "fingerprint written to ${META_FILE}"
  exit 0
fi

case "${MODEL_TYPE}" in
  qwen|qwen2|qwen3|qwen3_moe|qwen2_moe) FAMILY="qwen" ;;
  llama|mistral|llama4)                 FAMILY="llama" ;;
  mixtral)                              FAMILY="mixtral" ;;
  gemma|gemma2|gemma3|gemma3_text)      FAMILY="gemma" ;;
  *)
    die "unsupported model_type='${MODEL_TYPE}' (arch=${ARCH}) for TRT_BACKEND=tensorrt. Gemma 4 should use TRT_BACKEND=pytorch."
    ;;
esac

CONVERT_PY="$(find_script convert_checkpoint.py "${FAMILY}")" \
  || die "convert_checkpoint.py not found for family=${FAMILY} under ${TRTLLM_SRC}"
QUANTIZE_PY="$(find_script quantize.py)" || QUANTIZE_PY=""
log "convert script: ${CONVERT_PY}"

# ── 7. convert → TRT-LLM checkpoint ────────────────────────────────────────
CONVERT_ARGS=(
  --model_dir "${HF_DIR}"
  --output_dir "${CKPT_DIR}"
  --dtype "${TRT_DTYPE}"
)
case "${TRT_QUANTIZATION}" in
  int4_awq|awq)
    # Already-quantized AutoAWQ / ModelOpt AWQ checkpoints skip ModelOpt PTQ.
    if [[ "${QUANT_METHOD}" == "awq" || "${QUANT_METHOD}" == "compressed-tensors" ]]; then
      log "checkpoint is already ${QUANT_METHOD} — converting weights, not re-quantizing"
    elif [[ -n "${QUANTIZE_PY}" && "${QUANT_METHOD}" == "" ]]; then
      log "running ModelOpt INT4-AWQ calibration (${QUANTIZE_PY})"
      python "${QUANTIZE_PY}" \
        --model_dir "${HF_DIR}" \
        --dtype "${TRT_DTYPE}" \
        --qformat int4_awq \
        --awq_block_size 128 \
        --output_dir "${CKPT_DIR}" \
        --calib_size "${TRT_AWQ_CALIB_SIZE:-32}"
      CONVERT_PY=""   # quantize.py already emitted a TRT-LLM checkpoint
    fi
    if [[ -n "${CONVERT_PY}" ]]; then
      CONVERT_ARGS+=(--use_weight_only --weight_only_precision int4_awq --per_group)
    fi
    ;;
  int4_gptq|gptq)
    CONVERT_ARGS+=(--use_weight_only --weight_only_precision int4_gptq --per_group)
    ;;
  int8|int8_wo)
    CONVERT_ARGS+=(--use_weight_only --weight_only_precision int8)
    ;;
  fp16|none|float16)
    log "building FP16 weights (no weight-only quant)"
    ;;
  *)
    die "unknown TRT_QUANTIZATION='${TRT_QUANTIZATION}' (expected int4_awq|int4_gptq|int8|fp16)"
    ;;
esac

if [[ "${TRT_KV_CACHE_DTYPE}" == "int8" ]]; then
  CONVERT_ARGS+=(--int8_kv_cache)
  log "INT8 KV cache requested (lower quality, more concurrency headroom)"
fi

if [[ -n "${CONVERT_PY}" ]]; then
  if [[ -f "${CKPT_DIR}/config.json" && "${TRT_FORCE_REBUILD}" != "1" ]]; then
    log "reusing TRT-LLM checkpoint at ${CKPT_DIR}"
  else
    log "converting HF → TRT-LLM checkpoint"
    rm -rf "${CKPT_DIR}"
    mkdir -p "${CKPT_DIR}"
    python "${CONVERT_PY}" "${CONVERT_ARGS[@]}"
  fi
fi
[[ -f "${CKPT_DIR}/config.json" ]] || die "conversion produced no ${CKPT_DIR}/config.json"

# ── 8. trtllm-build (single-GPU Ampere engine) ─────────────────────────────
# In-flight batching = gpt_attention_plugin + remove_input_padding + paged KV.
# Chunked prefills   = use_paged_context_fmha (enables chunked context + block reuse).
# FP8 context FMHA is Hopper/Ada-only — forced off on SM 86.
log "compiling engine → ${ENGINE_DIR}"
rm -rf "${ENGINE_DIR}"
mkdir -p "${ENGINE_DIR}"

BUILD_ARGS=(
  --checkpoint_dir "${CKPT_DIR}"
  --output_dir "${ENGINE_DIR}"
  --max_batch_size "${TRT_MAX_NUM_SEQS}"
  --max_input_len "${TRT_MAX_MODEL_LEN}"
  --max_seq_len "${TRT_MAX_MODEL_LEN}"
  --max_num_tokens "${TRT_MAX_NUM_TOKENS}"
  --gpt_attention_plugin auto
  --gemm_plugin auto
  --moe_plugin auto
  --remove_input_padding enable
  --context_fmha enable
  --kv_cache_type paged
  --paged_kv_cache enable
  --use_paged_context_fmha enable
  --use_fp8_context_fmha disable
  --tokens_per_block "${TRT_TOKENS_PER_BLOCK}"
  --multiple_profiles enable
  --workers 1
  --log_level info
)

trtllm-build "${BUILD_ARGS[@]}"

engine_present "${ENGINE_DIR}" || die "trtllm-build finished but no .engine file in ${ENGINE_DIR}"
printf '%s\n' "${FINGERPRINT}" > "${META_FILE}"
# Tokenizer lives next to the engine so the serve wrapper does not need HF at runtime.
if [[ -d "${HF_DIR}" ]]; then
  ln -sfn "${HF_DIR}" "${ENGINE_DIR}/tokenizer"
fi

log "engine ready: ${ENGINE_DIR}"
ls -lh "${ENGINE_DIR}"/*.engine "${ENGINE_DIR}/config.json" 2>/dev/null || true
log "fingerprint written to ${META_FILE}"

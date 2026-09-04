#!/usr/bin/env bash
# Wrapper so supervisord's command= stays simple and this can be tuned
# independently of the ini file's own escaping rules.
#
# This pod's driver (>=580.65.06) supports CUDA 13, so the plain PyPI vLLM
# wheel works natively -- no from-source build, no LD_LIBRARY_PATH or
# attention-backend workarounds needed (all of that was specific to the
# previous pod's older driver, CUDA 12.8 ceiling).
#
# Serving stelterlab/Mistral-Small-24B-Instruct-2501-AWQ: 24B dense, AutoAWQ
# INT4 GEMM (~14-16GB, Apache-2.0). No --quantization flag (auto-detected).
# Tool calls via --tool-call-parser mistral + --tokenizer-mode mistral.
# AWQ repo misses tekken.json so --tokenizer points at the original Mistral
# repo (verified community workaround). Non-reasoning model: no
# --reasoning-parser flag. Mistral recommends low temperature at call time.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Always reload model flags from .env so a Muse/Qwen switch does not require
# a full supervisord restart (children otherwise keep the old process env).
if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

# ninja (needed by flashinfer to JIT-compile sampling kernels at startup)
# installs to the venv's bin/, which isn't on PATH when execing vllm
# directly -- add it explicitly.
export PATH="/workspace/venvs/vllm/bin:${PATH}"

exec /workspace/venvs/vllm/bin/vllm serve "${VLLM_MODEL}" \
  --served-model-name "${VLLM_SERVED_NAME}" \
  --tokenizer mistralai/Mistral-Small-24B-Instruct-2501 \
  --tokenizer-mode mistral \
  --gpu-memory-utilization "${VLLM_GPU_MEMORY_UTILIZATION}" \
  --max-model-len "${VLLM_MAX_MODEL_LEN}" \
  --max-num-seqs "${VLLM_MAX_NUM_SEQS}" \
  --enable-auto-tool-choice \
  --tool-call-parser mistral \
  --dtype auto \
  --host 0.0.0.0 \
  --port 8000

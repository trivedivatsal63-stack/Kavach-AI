#!/usr/bin/env bash
# Wrapper so supervisord's command= stays simple and this can be tuned
# independently of the ini file's own escaping rules.
#
# This pod's driver (>=580.65.06) supports CUDA 13, so the plain PyPI vLLM
# wheel works natively -- no from-source build, no LD_LIBRARY_PATH or
# attention-backend workarounds needed (all of that was specific to the
# previous pod's older driver, CUDA 12.8 ceiling).
#
# Serving stelterlab/Qwen3-30B-A3B-Instruct-2507-AWQ: the original intended
# model -- sparse MoE (~3B active params/token, vs the dense 32B fallback
# used on the old pod) with real AWQ/Marlin quantization (faster inference
# than bitsandbytes). Its own config.json ships max_position_embeddings=262144
# with rope_scaling=null, so no --rope-scaling flag needed here either.
set -euo pipefail

# ninja (needed by flashinfer to JIT-compile sampling kernels at startup)
# installs to the venv's bin/, which isn't on PATH when execing vllm
# directly -- add it explicitly.
export PATH="/workspace/venvs/vllm/bin:${PATH}"

exec /workspace/venvs/vllm/bin/vllm serve "${VLLM_MODEL}" \
  --served-model-name "${VLLM_SERVED_NAME}" \
  --gpu-memory-utilization "${VLLM_GPU_MEMORY_UTILIZATION}" \
  --max-model-len "${VLLM_MAX_MODEL_LEN}" \
  --max-num-seqs "${VLLM_MAX_NUM_SEQS}" \
  --dtype auto \
  --host 0.0.0.0 \
  --port 8000

#!/usr/bin/env bash
# Wrapper so supervisord's command= stays simple and this can be tuned
# independently of the ini file's own escaping rules.
#
# No --rope-scaling: stelterlab/Qwen3-30B-A3B-Instruct-2507-AWQ's own
# config.json already ships max_position_embeddings=262144 with
# rope_scaling=null -- the checkpoint natively supports far more than our
# VLLM_MAX_MODEL_LEN target (131072), no YaRN extrapolation needed. Confirmed
# directly against the model config, not assumed. The flag also does not
# exist in the installed vLLM version's serve CLI surface either way.
set -euo pipefail

# Uses /workspace/venvs/vllm-src, a vLLM 0.20.0 build compiled FROM SOURCE
# against this pod's local CUDA 12.4 toolkit (CUDA_HOME=/usr/local/cuda-12.4,
# TORCH_CUDA_ARCH_LIST=8.6), not the PyPI wheel. The PyPI wheel's precompiled
# _C.so and vllm-flash-attn extensions are built against CUDA 13, which this
# pod's driver (570.195.03, CUDA 12.8 ceiling) cannot run -- confirmed live
# across four separate crash sites (import-time ImportError, UVA buffer
# setup, and FlashAttention's own hardware_info.h capability check, the
# latter surviving even a TRITON_ATTN override). Building locally against a
# CUDA 12.4 toolkit the driver natively supports sidesteps the whole class of
# bug -- no LD_LIBRARY_PATH or attention-backend workaround needed anymore.
exec /workspace/venvs/vllm-src/bin/vllm serve "${VLLM_MODEL}" \
  --served-model-name "${VLLM_SERVED_NAME}" \
  --gpu-memory-utilization "${VLLM_GPU_MEMORY_UTILIZATION}" \
  --max-model-len "${VLLM_MAX_MODEL_LEN}" \
  --max-num-seqs "${VLLM_MAX_NUM_SEQS}" \
  --quantization bitsandbytes \
  --load-format bitsandbytes \
  --enforce-eager \
  --dtype auto \
  --host 0.0.0.0 \
  --port 8000

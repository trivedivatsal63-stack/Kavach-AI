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

exec /workspace/venvs/vllm/bin/vllm serve "${VLLM_MODEL}" \
  --served-model-name "${VLLM_SERVED_NAME}" \
  --gpu-memory-utilization "${VLLM_GPU_MEMORY_UTILIZATION}" \
  --max-model-len "${VLLM_MAX_MODEL_LEN}" \
  --max-num-seqs "${VLLM_MAX_NUM_SEQS}" \
  --enforce-eager \
  --dtype auto \
  --host 0.0.0.0 \
  --port 8000

#!/usr/bin/env bash
# Wrapper so supervisord can pass YaRN rope-scaling JSON without ini escaping issues.
set -euo pipefail

exec /workspace/venvs/vllm/bin/vllm serve "${VLLM_MODEL}" \
  --served-model-name "${VLLM_SERVED_NAME}" \
  --gpu-memory-utilization "${VLLM_GPU_MEMORY_UTILIZATION}" \
  --max-model-len "${VLLM_MAX_MODEL_LEN}" \
  --rope-scaling '{"rope_type":"yarn","factor":4.0,"original_max_position_embeddings":32768}' \
  --max-num-seqs "${VLLM_MAX_NUM_SEQS}" \
  --enforce-eager \
  --dtype auto \
  --host 0.0.0.0 \
  --port 8000

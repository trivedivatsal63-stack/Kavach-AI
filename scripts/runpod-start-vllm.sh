#!/usr/bin/env bash
# Wrapper so supervisord's command= stays simple and this can be tuned
# independently of the ini file's own escaping rules.
#
# This pod's driver (>=580.65.06) supports CUDA 13, so the plain PyPI vLLM
# wheel works natively -- no from-source build, no LD_LIBRARY_PATH or
# attention-backend workarounds needed (all of that was specific to the
# previous pod's older driver, CUDA 12.8 ceiling).
#
# Serving cyankiwi/Muse-Glimmer-30B-AWQ-INT4: dense 29.6B + ViT-G/14, compressed-tensors
# W4A16 pack-quantized (group 32, asymmetric). No --quantization flag (auto).
# Requires vLLM nightly with PR 51655 (muse_glimmer model + parsers).
# Channel format: to=self reasoning, ATEM tool calls — needs both parsers + generation-config auto.
# Conservative concurrency: max_num_seqs 4 for 131K on 48GB A6000; nightly default would be 16.
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
  --enable-auto-tool-choice \
  --tool-call-parser muse_glimmer \
  --reasoning-parser muse_glimmer \
  --generation-config auto \
  --dtype auto \
  --host 0.0.0.0 \
  --port 8000

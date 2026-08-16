# Dedicated embedding service — the RAG module's vectorizer.
#
# Strategy: GPU-first with automatic CPU fallback (see app/embedder.py).
# - At startup it probes for CUDA and reads free VRAM; it only enables the
#   GPU provider when there is enough free VRAM (EMBEDDING_GPU_MIN_FREE_MB,
#   default 1536). On a card where the chat model (vllm) already holds most
#   of VRAM, the probe selects CPU and the GPU stays untouched — this is
#   env-var tuned per machine, not hardcoded to any specific card, so it
#   doesn't need updating when the hardware changes.
# - At runtime, any CUDA error (e.g. VRAM freed up mid-flight by another
#   process) permanently downgrades that worker to CPU and retries.
# - When you scale to a bigger GPU / more concurrent RAG builders, the same
#   image automatically uses CUDA — no code or config change.
#
# onnxruntime-gpu 1.21-1.26 are built against CUDA 12.8 + cuDNN 9.x, so the
# base image must provide cuDNN 9 (the cudnn-runtime tag). zlib1g and libgomp1
# are required by cuDNN 9 / onnxruntime on Ubuntu.

FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/root/.cache/huggingface

# Port 80 (plain HTTP) is blocked outbound in some Docker network setups
# (corporate proxy/firewall) while 443 works fine — force apt to use the
# HTTPS mirrors so `apt-get update` doesn't hang on connection-refused.
RUN sed -i 's|http://archive.ubuntu.com|https://archive.ubuntu.com|g; s|http://security.ubuntu.com|https://security.ubuntu.com|g' /etc/apt/sources.list && \
    apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-dev \
    zlib1g \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
EXPOSE 8002

# uvicorn with a single worker: the model is loaded once and the GPU/CPU
# decision is made once at startup. If you later serve a bigger fleet,
# run more replicas (each does its own probe) rather than more workers here.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]

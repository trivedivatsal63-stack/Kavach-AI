# Kavach-AI: Design and Architecture of a Self-Hosted, Multi-Tenant Retrieval-Augmented Generation Platform

*A Systems Research Paper  --  Architecture, Component Analysis, Data Flows, and Empirical Design Decisions*

**Version:** 1.0  --  August 2026  
**Codebase:** `V:\AI_API_PLATFORM\Kavach-AI`  
**Stack:** vLLM + LiteLLM + Express (TypeScript) + React + PostgreSQL + Qdrant + fastembed/ONNX Runtime + SearXNG

---

## Abstract

Kavach-AI is a self-hosted, multi-tenant API platform that exposes OpenAI-compatible chat completions and retrieval-augmented generation (RAG) over user-owned documents. The platform is built as a hybrid of containerised and host-native services: vLLM provides high-throughput LLM inference with PagedAttention and AWQ quantisation; LiteLLM acts as a control plane for virtual API keys, per-key budgets and spend accounting backed by PostgreSQL; a dedicated embedding microservice (fastembed on ONNX Runtime, with a cross-encoder reranker) serves both document and query embeddings with automatic GPU-to-CPU fallback; Qdrant stores per-tenant vector collections; PostgreSQL stores identity, billing, document metadata and a generated `tsvector` column for hybrid keyword search; SearXNG provides live web augmentation. The TypeScript/Express backend orchestrates ingestion (format-aware parsing and structure-aware chunking), hybrid retrieval (dense + sparse fused via Reciprocal Rank Fusion, cross-encoder reranking, and a real token-budget walk against vLLM's own BPE counts), and grounded generation with numbered citations; the React 19 dashboard provides key management, document lifecycle, and conversational UIs. Two deployment topologies are supported  --  a local hybrid (Docker for inference + host processes) and a RunPod-native `supervisord` whole-stack on an RTX A6000. This paper documents every component, every interface, every data flow, failure semantic, and the verified incidents that shaped the current design.

**Keywords:** retrieval-augmented generation, vector database, hybrid search, reciprocal rank fusion, cross-encoder reranking, vLLM, LiteLLM, Qdrant, ONNX Runtime, multi-tenancy, self-hosted LLM.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Overview and Design Principles](#2-system-overview-and-design-principles)
3. [Deployment Topologies](#3-deployment-topologies)
4. [Component Analysis](#4-component-analysis)  --  vLLM, LiteLLM, Embedding Service, Reranker, Qdrant, PostgreSQL, SearXNG, Backend, Frontend
5. [Cross-Cutting Data Flows](#5-cross-cutting-data-flows)  --  Identity & Budgets; Ingestion; Retrieval & Fusion; Token Accounting; Generation; Live Search
6. [Interaction Matrix and Interface Contracts](#6-interaction-matrix-and-interface-contracts)
7. [Failure Semantics and Degradation Ladder](#7-failure-semantics-and-degradation-ladder)
8. [Security and Multi-Tenancy Model](#8-security-and-multi-tenancy-model)
9. [Empirical Design Decisions](#9-empirical-design-decisions)
10. [Limitations and Future Work](#10-limitations-and-future-work)
11. [Conclusion](#11-conclusion)
- Appendices: A Port Map, B Constants, C Public API Surface, D Environment Variables

---

## 1. Introduction

### 1.1 Motivation

Public LLM APIs couple model access with vendor-controlled data retention, pricing, and rate limits. For workloads involving proprietary or regulated documents (statutes, contracts, financial filings), organisations require (a) data residency guarantees  --  documents and vectors never leave their infrastructure, (b) predictable cost control per tenant and per key, and (c) citation-grounded answers where every factual claim can be traced to a numbered source chunk or live web result. Kavach-AI addresses these needs as a self-hosted alternative that is OpenAI-compatible on the wire but fully owned on the metal.

### 1.2 Problem Statement

Building such a platform requires solving a compound systems problem:

* **Inference efficiency** on VRAM-constrained hardware (4 GB laptop GPUs vs. 48 GB datacentre cards) without code changes per machine.
* **Multi-tenant isolation** at the storage layer, not merely the application layer.
* **Retrieval precision** on long, highly structured documents (e.g., Indian statutes with `(a) "term" means ...` definition lists) where pure dense search fails on exact defined-term queries.
* **Hard token-budget correctness**  --  never overflowing the model's context window, which is only 2,048 tokens locally.
* **Graceful degradation** when any of the five backing services is temporarily unavailable.

### 1.3 Contributions

This paper contributes a complete, file-grounded reconstruction of Kavach-AI's architecture (`docker-compose.yml:1-189`, `litellm/config.yaml:1-44`, `embedding/app/*.py`, `backend/src/**/*.ts`), including formal treatment of the hybrid retrieval pipeline, the GPU-arbitration state machine, the per-tenant collection strategy, and the empirically verified failure modes that motivated each current design choice.

---

## 2. System Overview and Design Principles

### 2.1 Guiding Principles

1. **Single source of truth per concern.** LiteLLM owns keys/budgets/spend (`litellm/config.yaml:42-43`); Qdrant owns vectors; PostgreSQL owns metadata and full-text indexes. No second ledger is maintained locally  --  usage is aggregated live from `GET /spend/logs/v2` (`backend/src/services/litellm.service.ts:206-244`).
2. **Structural isolation over filter-based isolation.** Qdrant uses one collection per user `rag_user_${userId}` (`backend/src/services/rag/qdrant.service.ts:36-38`). A query against user B's collection cannot return user A's points even if application code is buggy.
3. **Token-budget discipline.** Every context-assembly step performs a real token-count walk against vLLM's own BPE vocabulary via `POST /tokenize` (`backend/src/services/rag/tokenizer.service.ts:18-29`), not an approximation. The walk is best-first, never skips an oversized chunk to grab a smaller one out of rank order, and always keeps at least one chunk (`backend/src/services/rag/retrieval.service.ts:206-244`).
4. **Graceful degradation.** Cross-encoder reranking and live search are precision/coverage enhancements that fall back to the existing ranking or empty results on failure, never failing the overall request (`backend/src/services/rag/reranker.service.ts:50-53`, `backend/src/services/liveSearch/liveSearch.service.ts:20-24`).
5. **Empirical verification.** Non-obvious constants and choices are documented with the incident that motivated them (e.g., `RRF_K=60`, `CANDIDATE_POOL_SIZE=24`).

### 2.2 Logical Topology

```
                    +-------------------+        +-------------------+
  Browser  ------->  |  Frontend :5173   | -----> |  Backend  :4001   |
  :5173  React 19    |  (Vite, React 19) |  REST  |  (Express 5)      |
                    +---------+---------+        +---------+---------+
                              |                            |
                              |                            +---> LiteLLM :4000 (Docker)
                              |                            |     ghcr.io/berriai/litellm
                              |                            |     |
                              |                            |     +---> vLLM :8000 (Docker)
                              |                            |     |     vllm/vllm-openai:v0.26.0
                              |                            |     |     Qwen2.5-1.5B-AWQ (local)
                              |                            |     |     Qwen3-30B-A3B-AWQ (RunPod)
                              |                            |     |
                              |                            +---> Embedding :8002
                              |                            |     FastAPI + fastembed/ONNX
                              |                            |     paraphrase-multilingual-MiniLM-L12-v2 (384d)
                              |                            |     + reranker Xenova/ms-marco-MiniLM-L-6-v2
                              |                            |
                              |                            +---> Qdrant :6333
                              |                            |     per-user collections, Cosine
                              |                            |
                              |                            +---> PostgreSQL :5432
                              |                            |     DBs: `litellm` + `dashboard`
                              |                            |     Prisma + raw pg.Pool
                              |                            |
                              |                            +---> SearXNG :8888->8080
                              |                                  metasearch relay (JSON)
                              |
                    +---------+---------+
                    |  PostgreSQL :5432 |  <--- LiteLLM via host.docker.internal (extra_hosts: host-gateway)
                    |  litellm + dashboard DBs
                    +-------------------+
```

All inter-service contracts are plain HTTP/REST with JSON. The only non-LiteLLM direct call is `POST /tokenize` to vLLM  --  explicitly justified as a stateless vocabulary lookup, not an inference call (`backend/src/services/rag/tokenizer.service.ts:12-17`).

---

## 3. Deployment Topologies

### 3.1 Local Hybrid (Developer Laptop)

| Service | Placement | Reachability |
|---------|-----------|--------------|
| vLLM + LiteLLM + Embedding + Qdrant + SearXNG | Docker (`docker compose up -d`) | Published ports on `localhost` |
| PostgreSQL, Backend, Frontend | Host terminals | Native processes |

* LiteLLM reaches vLLM via compose DNS `http://vllm:8000/v1` (`docker-compose.yml:73`, `litellm/config.yaml:11`).
* LiteLLM reaches host PostgreSQL via `host.docker.internal:5432` (`docker-compose.yml:66-71`). One-time host configuration requires `listen_addresses='*'` and `pg_hba.conf` entry `host all all 0.0.0.0/0 scram-sha-256`.
* Backend (host) reaches embedding at `http://127.0.0.1:8002` and Qdrant at `http://127.0.0.1:6333`  --  unchanged whether those services run in Docker or as native processes, since both publish the same host ports.
* Shared named volume `huggingface_cache:/root/.cache/huggingface` between vLLM and embedding avoids re-downloading models on container recreation (`docker-compose.yml:27-28,106-109`).
* Start order: Windows Postgres service -> `docker compose up -d` (wait for `Application startup complete` in vLLM logs, then `GET /health/readiness` on LiteLLM) -> embedding/Qdrant -> `backend: npm run dev` -> `frontend: npm run dev`. See `scripts/LOCAL_RUN.md` and `scripts/show-local-run.ps1:1-...`.

The defaults are tuned for a 4 GB VRAM laptop (RTX 2050 class): `VLLM_GPU_MEMORY_UTILIZATION=0.70`, `VLLM_MAX_MODEL_LEN=2048`, `VLLM_MAX_NUM_SEQS=4` (`docker-compose.yml:34-38`). A larger GPU only requires raising env vars, not editing the compose file.

An alternative bare-metal WSL path (`scripts/start-vllm-wsl.sh`) sources the root `.env` and execs `python -m vllm.entrypoints.openai.api_server` with identical flags, kept for debugging without Docker.

### 3.2 RunPod Native (Production Pod, RTX A6000 48 GB)

No Docker-in-Docker is used  --  a pod already is one container and lacks privileged mode. All services run as OS processes under `supervisord` (`scripts/supervisord.conf`), with explicit priorities that encode the dependency DAG:

```
supervisord
 |-- postgres   :5432  prio 10  (scram on TCP, peer locally; initdb at /var/lib/postgresql/pgdata)
 |-- vllm       :8000  prio 20  (startsecs 30, retries 3, HF_HOME=/workspace/.hf-cache)
 |-- litellm    :4000  prio 30  (VLLM_API_BASE=http://127.0.0.1:8000/v1)
 |-- embedding  :8002  prio 40  (uvicorn 127.0.0.1:8002, LD_LIBRARY_PATH -> vllm venv cu13 libs)
 |-- qdrant     :6333  prio 40  (static musl binary v1.18.3 at /workspace/qdrant/qdrant)
 |-- searxng    :8889  prio 40  (Flask CLI `python -m flask --app searx.webapp run`, port 8889 avoids Jupyter collision on 8888)
 |-- backend    :4001  prio 50  (prisma db push --accept-data-loss && node dist/index.js)
 +-- frontend   :5173  prio 60  (vite preview --host 0.0.0.0)
```

Only LiteLLM (4000), backend (4001) and frontend (5173) are exposed via RunPod proxy URLs `https://<pod-id>-<port>.proxy.runpod.net`. PostgreSQL is intentionally not exposed; operators use an SSH tunnel for GUI tools. The model profile switches to `stelterlab/Qwen3-30B-A3B-Instruct-2507-AWQ` served as `qwen3-30b-a3b` with `VLLM_MAX_MODEL_LEN=131072` (128 K via YaRN; `max_position_embeddings=262144` natively so no rope-scaling flag is needed), `VLLM_GPU_MEMORY_UTILIZATION=0.75`, `VLLM_MAX_NUM_SEQS=8`. Volume disk must be >= 100 GB at `/workspace`; termination destroys `/workspace/pgdata` and `/workspace/qdrant/storage` unless backed up  --  stop/restart is safe.

Lifecycle scripts:

* **`scripts/runpod-setup.sh`** (one-time, idempotent, 10 steps): installs system packages + Node 20 LTS; creates `litellm` and `dashboard` DBs; creates three venvs at `/workspace/venvs/{vllm,litellm,embedding,searxng}`; installs Qdrant binary; builds backend/frontend; notably force-uninstalls the CPU `onnxruntime` that `fastembed` transitively pulls in, because co-install with `onnxruntime-gpu` silently decides providers via who wins the shared import namespace.
* **`scripts/runpod-deploy.sh`** (idempotent bring-up): refuses placeholder secrets (`change-me*`); requires `RUNPOD_POD_ID`; computes three proxy URLs and upserts env vars including `LITELLM_BASE_URL`, `VLLM_BASE_URL`, `QDRANT_URL`, `EMBEDDING_BASE_URL`, `SEARXNG_URL`, URL-encoded `DATABASE_URL`/`LITELLM_DATABASE_URL`; syncs Postgres role password via peer auth; rebuilds frontend with baked `VITE_*` URLs; restarts supervisord; polls health endpoints (vLLM allowed 1800 s for ~19 GB first download).
* **`scripts/redeploy.sh`**: incremental post-`git pull` redeploy; diffs against `/workspace/.last-redeploy-commit` and only rebuilds/restarts services whose paths changed; first run treats everything as changed.
* **`scripts/runpod-start-vllm.sh`**: execs `vllm serve $VLLM_MODEL ...` prepending the vllm venv bin to `PATH` for flashinfer's ninja JIT.

**Known platform limitation:** the RunPod proxy caps request duration at ~100 s, returning HTTP 524 on long chats or large uploads. Streaming verification is open follow-up work (`scripts/RUNPOD_DEPLOY.md` troubleshooting section).

---

## 4. Component Analysis

### 4.1 vLLM  --  Inference Engine

**Image and runtime.** `vllm/vllm-openai:v0.26.0` (`docker-compose.yml:20`) is chosen for broad CUDA-arch coverage across modern consumer and laptop GPUs. `ipc: host` enables shared-memory for PyTorch DataLoader and CUDA IPC. `VLLM_WSL2_ENABLE_PIN_MEMORY=1` is required under Docker Desktop's WSL2 backend.

**Why vLLM.** vLLM's PagedAttention partitions the KV cache into non-contiguous blocks, eliminating the fragmentation that forces other servers to over-reserve contiguous memory per sequence. Combined with continuous batching (new requests join a running batch without waiting for the current batch to finish) and prefix caching, this yields 2-4x higher throughput than naive HuggingFace `generate()` loops. AWQ (Activation-aware Weight Quantisation) kernels execute 4-bit quantised weights (see below) without dequantising to FP16 in HBM, halving memory traffic.

**Model profiles.**

| Profile | HF ID | Served name | Quant. | Context | GPU util | Max seqs | Use |
|---------|-------|-------------|--------|---------|----------|----------|-----|
| Laptop (default) | `Qwen/Qwen2.5-1.5B-Instruct-AWQ` | `qwen2.5-1.5b` | AWQ 4-bit | 2,048 | 0.70 | 4 | Dev, 4 GB VRAM |
| Laptop alt (8 GB) | `Qwen/Qwen2.5-7B-Instruct-AWQ` | `qwen2.5-7b` (alias) | AWQ 4-bit | 8,192 | 0.85 | 8 | Commented example in `.env.example` |
| RunPod | `stelterlab/Qwen3-30B-A3B-Instruct-2507-AWQ` | `qwen3-30b-a3b` | AWQ 4-bit | 131,072 | 0.75 | 8 | Production, 48 GB |

The `qwen2.5-7b` alias in `litellm/config.yaml:18-24` deliberately maps the old 7 B name to the same 1.5 B weights  --  clients using the previous name continue to work on the small machine without a separate model load.

**CLI flags (`docker-compose.yml:33-42`).**

* `--enforce-eager` disables CUDA graph capture. Graphs reduce launch overhead but cost extra memory and are fragile under WSL2's virtualised driver. On a 4 GB card the memory saving outweighs the ~5-10% throughput loss.
* `--dtype auto` lets vLLM pick BF16/FP16 per GPU capability.
* `--gpu-memory-utilization` is the fraction of *total* VRAM the engine may reserve for KV cache + weights; it is not a per-request limit.
* `--max-model-len` is the hard ceiling that the backend's token-budget logic mirrors via `MODEL_MAX_CONTEXT_TOKENS` (`backend/src/utils/rag.constants.ts:62`). Mismatching the two silently reintroduces overflow risk.
* `--max-num-seqs` caps concurrent sequences in one continuous batch, bounding latency tail on small GPUs.

**API surface.** vLLM exposes an OpenAI-compatible REST API at `/v1/*` consumed by LiteLLM via the `openai/` provider (`litellm/config.yaml:10,20,28`). It also exposes `POST /tokenize {model, prompt}` returning `{count}` (`backend/src/services/rag/tokenizer.service.ts:19-28`). The `prompt` field is a single string (not an array)  --  batch tokenisation is not supported, which is why `retrieval.service.ts:201-205` notes that token counting is per-citation without batching.

**Health lifecycle.** `HEALTHCHECK CMD curl -f http://localhost:8000/health` with `start_period: 600s` (`docker-compose.yml:52-57`) accommodates first-run model downloads (~1-19 GB depending on profile). LiteLLM declares `depends_on: vllm: condition: service_healthy` (`docker-compose.yml:62-64`), so it never starts before vLLM is ready. The pod's `runpod-deploy.sh` allows 1800 s for vLLM.

### 4.2 LiteLLM  --  Gateway, Key Management and Spend Ledger

**Role.** LiteLLM is the *only* path through which inference is invoked. Every `POST /v1/chat/completions`  --  whether from a user's programmatic API key, the RAG pipeline, or general chat  --  is sent with that key as `Bearer` to `LITELLM_BASE_URL` (`backend/src/services/rag/completion.service.ts:34`, `backend/src/services/litellm.service.ts:148-158`). LiteLLM validates the key, enforces RPM and budget limits, forwards to vLLM, and records spend. The backend never calls vLLM directly for completions.

**Image and wiring.** `ghcr.io/berriai/litellm:main-latest` on `:4000` (`docker-compose.yml:60-90`). Configuration is via `litellm/config.yaml:1-44` mounted read-only at `/app/config.yaml`:

```yaml
model_list:
  - model_name: qwen2.5-1.5b        # public name clients send; must match VLLM_SERVED_NAME / CHAT_MODEL
    litellm_params:
      model: openai/qwen2.5-1.5b
      api_base: os.environ/VLLM_API_BASE   # http://vllm:8000/v1 in Docker, http://127.0.0.1:8000/v1 on pod
      api_key: not-needed
      input_cost_per_token: 0.0001          # placeholder rates so budget/spend arithmetic works for self-hosted models
      output_cost_per_token: 0.0002
  # ... alias qwen2.5-7b -> same weights, production qwen3-30b-a3b
litellm_settings: { drop_params: true, default_key_generate_params: { rpm_limit: 20, max_budget: 5.0, budget_duration: "30d" } }
general_settings: { master_key: os.environ/LITELLM_MASTER_KEY, database_url: os.environ/DATABASE_URL, store_model_in_db: true }
```

* `drop_params: true` strips unknown OpenAI params instead of rejecting them  --  important for forward compatibility when clients send newer fields.
* `store_model_in_db: true` persists the model list to PostgreSQL so the LiteLLM UI can reflect it.
* Placeholder costs (`0.0001`/`0.0002`) are not real billing  --  they convert token counts into a dollar-denominated `spend` that can be compared against `max_budget`.

**PostgreSQL control plane.** `DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@host.docker.internal:${POSTGRES_PORT}/litellm` (`docker-compose.yml:71`). In Docker this traverses `extra_hosts: host-gateway`; on the pod it is `127.0.0.1:5432`. The `litellm` database is created idempotently by `scripts/runpod-setup.sh` and `postgres/init-multi-db.sh` (local compose era). Tables are managed entirely by LiteLLM's own migrations; the backend never writes to this database except via LiteLLM's admin API.

**Admin API used by the backend (`backend/src/services/litellm.service.ts:1-244`).**

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/key/generate` | POST | master key | `{max_budget, metadata:{dashboard_user_id}}` -> `{key, token_id}` |
| `/key/delete` | POST | master key | `{keys:[tokenId]}`  --  revocation |
| `/key/info?key=` | GET | master key | `{spend, max_budget}` for display |
| `/key/update` | POST | master key | `{key: tokenId, max_budget}`  --  mock top-up |
| `/v1/chat/completions` | POST | caller key | Real inference (test-key path) |
| `/spend/logs/v2?api_key=&start_date=&end_date=&page_size=` | GET | master key | Per-key usage aggregation (`getLiteLLMKeyUsage`) |

`masterKey()` reads `env.litellmMasterKey()` (`backend/src/services/litellm.service.ts:9-11`). All admin fetches go through `litellmFetch` which surfaces a 503 with actionable guidance when the compose stack is down (`backend/src/services/litellm.service.ts:20-36`). Test-key calls deliberately use the *caller-supplied* key, mirroring a real client (`backend/src/services/litellm.service.ts:143-190`).

**Health.** `HEALTHCHECK CMD python3 -c "urllib.request.urlopen('http://localhost:4000/health/readiness')"` with `start_period: 45s` (`docker-compose.yml:80-90`).

---

### 4.3 Embedding Microservice

**Purpose.** The RAG module's vectoriser is intentionally isolated as a dedicated service (`embedding/` in the repo root) behind a plain HTTP boundary (`backend/src/services/rag/embedding.service.ts:1-44`). This keeps the vector backend swappable  --  replacing it with any OpenAI-embeddings-style API requires no changes to ingestion or retrieval code.

**Runtime.** FastAPI + `fastembed` (`TextEmbedding`, `TextCrossEncoder`) wrapping **ONNX Runtime**. Base image `nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04` (`embedding/Dockerfile:19`) because `onnxruntime-gpu` 1.21-1.26 are built against CUDA 12.8 + cuDNN 9.x  --  a plain `python:slim` image would lack `libgomp1`/`zlib1g`/`libcudnn9`, causing silent fallback to CPU or `ImportError`. The Dockerfile forces apt to HTTPS mirrors (`embedding/Dockerfile:26-27`) to work behind corporate proxies that block port 80. `HF_HOME=/root/.cache/huggingface` points at the same named volume as vLLM, so the model download persists across container recreation. A single `uvicorn` worker is used by design (`embedding/Dockerfile:46`): the model is loaded once and the GPU/CPU decision is made once at startup; scale is via replicas, not workers.

**Dependencies (`embedding/requirements.txt` / `requirements-cpu.txt`).**

| Package | Constraint | Notes |
|---------|------------|-------|
| `fastapi` | `>=0.115,<1.0` | HTTP framework |
| `uvicorn[standard]` | `>=0.30,<1.0` | ASGI server |
| `fastembed` | `>=0.5,<1.0` | ONNX embedding/reranking abstraction |
| `onnxruntime-gpu` | `>=1.21,<1.27` | GPU ORT; installing it replaces the CPU `onnxruntime` that fastembed pulls transitively |
| `nvidia-ml-py` | `>=12.0,<13.0` | `pynvml` VRAM probe |

The CPU-only `requirements-cpu.txt` pins plain `onnxruntime` instead. On RunPod, `runpod-setup.sh:102-109` force-uninstalls the CPU package after install because co-install leaves both in `site-packages` and whichever wins the shared `onnxruntime.*` namespace silently decides available providers.

**Model and vector geometry.** Default `EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (`docker-compose.yml:100`, `embedding/app/main.py:env`)  --  a 12-layer MiniLM, multilingual (50+ languages), 384-dimensional, ~470 MB ONNX, fast on CPU and small enough that GPU acceleration is optional. `EMBEDDING_DIM=384` must match `ragConfig.embeddingDim` and Qdrant collection `size`  --  a mismatch raises an actionable error (`backend/src/services/rag/qdrant.service.ts:79-85`).

**API (`embedding/app/main.py`).**

| Endpoint | Method | Body | Semantics |
|----------|--------|------|-----------|
| `/health` | GET |  --  | `{status, provider, model, dim, reranker_provider, reranker_model}`  --  consumed by compose healthcheck via `urllib` |
| `/embed` | POST | `{texts: string[1..512]}` | Passage/document embeddings (`is_query=False`) |
| `/embed/query` | POST | `{texts: string[1..512]}` | Query embeddings (`is_query=True`, applies query prompt when the model supports it) |
| `/rerank` | POST | `{query: string, documents: string[1..128]}` | Cross-encoder scores for (query, doc) pairs |

Responses: `{embeddings: number[][], dim: number}` and `{scores: number[]}`. No auth  --  intended to be internal-only on a private network.

**GPU arbitration state machine (`embedding/app/embedder.py:80-111`, mirrored in `reranker.py`).**

```
EMBEDDING_PROVIDER=cpu  --> CPUExecutionProvider unconditionally
EMBEDDING_PROVIDER=cuda --> require CUDAExecutionProvider in ORT available providers, else raise
EMBEDDING_PROVIDER=auto --> if CUDA in available providers:
                                free_MB = nvmlDeviceGetMemoryInfo(device 0).free / 1 MiB
                                if free_MB >= EMBEDDING_GPU_MIN_FREE_MB (default 1536): use CUDA
                                else: use CPU
                            else: use CPU
Load failure with CUDA --> rebuild as CPU-only (single retry at construction)
Runtime exception during embed() on CUDA --> permanently rebuild on CPU, retry batch once
```

The threshold is the arbitration knob for a shared 4 GB card where vLLM already holds ~3 GB. When vLLM claims most of VRAM, the probe selects CPU and the GPU stays untouched. On a 48 GB A6000 (`EMBEDDING_PROVIDER=auto` in `.env.runpod.example`), the same image automatically uses CUDA with no code or config change. Crucially, the ONNX artifact is identical for both providers, so GPU<->CPU switches never change vector dimensionality or embedding space (`embedding/app/embedder.py` docstring).

**Asymmetric embeddings.** `embedDocuments` routes to `POST /embed` and `embedQueries` to `POST /embed/query` (`backend/src/services/rag/embedding.service.ts:14-20`). The query path calls fastembed's `query_embed()` when available, which prepends task prompts such as `s2p_query` for MiniLM-family models, improving query-passage alignment. Batch size is fixed at 32 for both paths (`embedding/app/embedder.py:136-138`).

---

### 4.4 Cross-Encoder Reranker

The reranker (`embedding/app/reranker.py`) deliberately mirrors the embedder's structure with no shared code, because it probes free VRAM independently at its own load time  --  after the embedder has already claimed memory (`embedding/app/main.py:33-37`).

* Class: `fastembed.TextCrossEncoder` (`reranker.py:102-105`).
* Model: `Xenova/ms-marco-MiniLM-L-6-v2`  --  a 6-layer MiniLM cross-encoder trained on MS MARCO. Unlike a bi-encoder, it reads the `(query, document)` pair jointly through full self-attention, producing a far more accurate relevance signal at the cost of not being pre-indexable (hence its use as a second-stage reranker over a small candidate pool, not as the primary index).
* Scoring: raw logits are passed through `sigmoid` -> `[0,1]` relevance probability (`reranker.py:119-126`), matching the `Citation.score` "match %" contract displayed in the UI.
* Output: scores only; actual re-sorting happens in `backend/src/services/rag/retrieval.service.ts:188-192`.
* Fallback: identical CUDA->CPU downgrade-and-retry semantics; the HTTP client (`backend/src/services/rag/reranker.service.ts:21-53`) returns `null` on any failure so the caller falls back to the fused ranking untouched.

---

### 4.5 Qdrant  --  Vector Store

**Isolation model.** One collection per user, named `rag_user_${userId}` (`backend/src/services/rag/qdrant.service.ts:36-38`). `userId` is always server-resolved from JWT or from a looked-up `rag_keys` row  --  never taken from request body/params  --  so the collection name cannot be attacker-controlled. Isolation is structural: even a bug in filter construction cannot leak another tenant's vectors because they live in a different collection.

**Configuration.** Lazily created on first upload via `ensureUserCollection` (`qdrant.service.ts:56-87`): `vectors: {size: 384, distance: "Cosine"}` and a payload index `field_name: "document_id", field_schema: "keyword"` for per-document `delete` and `query` filtering. Existing collections are validated: if `size != EMBEDDING_DIM`, an error with actionable guidance ("Drop the collection to reindex") is thrown  --  this catches model-change drift.

**Client.** `@qdrant/js-client-rest@^1.19.0` is ESM-only (`"type":"module"`), so the backend loads it via dynamic `import()` (`qdrant.service.ts:18-31`) to avoid a `require()`-of-ESM error under CommonJS/TS. `checkCompatibility: false` skips the version probe at boot when Qdrant may be temporarily down.

**Operations.**

* `upsertPoints(collection, points[])` maps `{id, vector, documentId, documentType?}` to `{id, vector, payload:{document_id, document_type?}}`. `document_type="tabular"` tags spreadsheet-row chunks for potential future distinct handling.
* `searchChunks({collection, vector, limit, documentIds?})` calls `client.query({query: vector, limit, filter:{must:[{key:"document_id", match:{any: documentIds}}]}, with_payload:false})`. `limit` is `CANDIDATE_POOL_SIZE=24`. A 404 (user never uploaded) returns `[]` rather than throwing (`qdrant.service.ts:144-149`).
* `deleteDocumentPoints(collection, documentId)` issues a filtered delete; 404 is swallowed.

**Persistence.** In Docker, `./qdrant/storage:/qdrant/storage` and `./qdrant/snapshots:/qdrant/snapshots` (`docker-compose.yml:143-148`) bind-mount the same on-disk data that the earlier standalone `qdrant.exe` used  --  collections carry over without re-ingestion. On the pod, Qdrant is the static musl binary `v1.18.3` at `/workspace/qdrant/qdrant`.

**Health.** No `curl`/`wget` in the minimal image  --  the healthcheck is a TCP probe via `bash -c "exec 3<>/dev/tcp/127.0.0.1/6333"` (`docker-compose.yml:151-157`).

---

### 4.6 PostgreSQL  --  Relational Core

PostgreSQL is the system's durable relational store and plays two distinct roles:

1. **LiteLLM control plane**  --  database `litellm`, owned entirely by LiteLLM's migrations, stores virtual keys, budgets, spend, and model metadata.
2. **Dashboard and RAG metadata**  --  database `dashboard` (or `kavach` locally), owned by the backend via Prisma and raw SQL, stores identity, document/chunk metadata, conversations, and the full-text index.

The two databases are created idempotently by `postgres/init-multi-db.sh` (local) and `runpod-setup.sh` (pod). The backend accesses its own database through two complementary clients:

* **Prisma ORM** (`@prisma/client@6.19.3`, `backend/prisma/schema.prisma:1-206`) for identity/billing tables.
* **Raw `pg.Pool`** (`pg@^8.22.0`, `backend/src/models/rag/pool.ts`) for RAG tables  --  because `rag_chunks.content_tsv` is a *generated* `tsvector` column that Prisma's `db push` would try to `ALTER`, so it is deliberately *undeclared* in the Prisma model (`schema.prisma:105-113` comment).

**Schema inventory (`backend/prisma/schema.prisma`).**

| Model | Table | Key fields | Purpose |
|-------|-------|------------|---------|
| `User` | `User` | `creditBalanceUsd Decimal(10,2) @default(5.0)`, `role "user"\|"superadmin"` (re-read every request), `status "active"\|"paused"\|"blocked"`, `deletedAt` soft delete, `isAdmin` legacy column | Accounts; credit drives every LiteLLM key's `max_budget` |
| `EmailOtp` | `EmailOtp` | `purpose`, `codeHash` (sha256 of 6-digit code), `expiresAt`, `attempts`, `payload Json` (signup-only `{passwordHash,name}`) | OTPs for signup / login-2FA / password reset; user row created only after email proof |
| `ApiKey` | `ApiKey` | `litellmKeyId String @unique` (hashed `token_id` from LiteLLM) | User-facing chat API keys; plaintext never stored |
| `RagDocument` | `rag_documents` | `status "queued"\|"processing"\|"indexed"\|"failed"`, `embeddingModel`, `chunkCount` | Upload lifecycle; declared in Prisma only to prevent drift  --  runtime DDL owned by `ensureSchema()` |
| `RagChunk` | `rag_chunks` | `headingPath JsonB`, `page Int?`, `tokenCount`, `content`, unique `(documentId, chunkIndex)`, **generated** `content_tsv tsvector` (undeclared) | Chunk rows; FTS indexed via `content_tsv` |
| `RagKey` | `rag_keys` | `keyHash` (sha256), `tokenId` (LiteLLM) both unique | User-facing RAG API keys (`POST /v1/rag/query`) |
| `RagChatKey` | `rag_chat_keys` | `userId @id`, `encryptedKey` (AES-256-GCM, recoverable) | One hidden per-user key shared by Chat UI + RAG Studio |
| `Conversation` | `conversations` | `mode "chat"\|"rag"`, `documentIds JsonB` (frozen at creation, never mutated) | Conversation containers; scope integrity rationale at `schema.prisma:158-162` |
| `Message` | `messages` | `role "user"\|"assistant"`, `citations JsonB`, `webCitations JsonB` (separate column to preserve citation contract), `promptTokens/completionTokens` | Turn storage |
| `AdminAuditLog` | `admin_audit_logs` |  --  | Superadmin action records (pause/block/delete/revoke)  --  documentation, not enforcement |

No Prisma enums are used  --  statuses/roles are string constants in `backend/src/utils/roles.ts` and `backend/src/utils/rag.constants.ts`.

**Full-text search.** The keyword leg of hybrid retrieval (`backend/src/services/rag/retrieval.service.ts:63-91`) queries:

```sql
SELECT c.id FROM rag_chunks c
JOIN rag_documents d ON d.id = c.document_id,
     to_tsquery('english', replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')) query
WHERE d.user_id = $1 AND d.deleted_at IS NULL
  AND c.content_tsv @@ query
  -- optional: AND c.document_id = ANY($3::text[])
ORDER BY ts_rank_cd(c.content_tsv, query) DESC
LIMIT $4
```

Key design choices:

* `plainto_tsquery` terms are converted from `&` (AND) to `|` (OR). A natural-language question stems to 12-16 terms; requiring all of them (AND) matches nothing on ~800-char chunks  --  verified: zero rows on every test query before this fix (`retrieval.service.ts:49-62` comment).
* `ts_rank_cd` (cover density) is used over `ts_rank` because it rewards term clustering, which matters for passage-length text.
* `english` config (stemming) is flagged as a future tuning knob  --  `simple` may suit citation-heavy legal text better.
* Tenancy is enforced via `JOIN rag_documents d ON d.id = c.document_id WHERE d.user_id = $1` because `rag_chunks` has no `user_id` column  --  the vector leg's structural isolation and the keyword leg's join-filter achieve the same guarantee via different mechanisms per storage engine (`retrieval.service.ts:29-33` comment).

---

### 4.7 SearXNG  --  Live Web Search

SearXNG is a self-hosted metasearch relay (`searxng/`): it queries Google/Bing/DuckDuckGo/etc. live on every call and returns merged results. There is no crawled index to keep fresh or grow on disk.

**Configuration (`searxng/settings.yml`).**

* `use_default_settings: true` with overrides: `server.secret_key` set, `image_proxy: true`, `limiter: false` (rate limiting is unnecessary for a server-to-server private network), and critically `search.formats: [html, json]`  --  JSON is off by default upstream but required because `backend/src/services/liveSearch/search.service.ts:14-16` fetches `?format=json`.
* `Dockerfile` copies `extra-certs/` into `/usr/local/share/ca-certificates/`  --  a workaround for Avast SSL interception on the developer's corporate laptop; an empty directory copies without error so fresh clones work.
* `docker-compose.yml:159-186` sets `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt` because SearXNG's Python `httpx` ignores the system bundle by default (unlike `wget` used in the healthcheck). Port `8888:8080` locally, `8889` on the pod to avoid collision with RunPod's Jupyter on `8888`. Healthcheck `wget -qO- http://localhost:8080/healthz`.

**Why not a commercial search API.** Self-hosting removes per-query cost and API-key management for a feature that is explicitly opt-in and low-volume, at the cost of relay latency that is acceptable for this use case.

---

### 4.8 Backend  --  Application Server

**Stack.** TypeScript 7, Express 5.2.1, `tsx` for dev, `vitest` for tests (`backend/package.json:1-...`). Runtime deps: `cors`, `dotenv`, `@prisma/client` + `pg`, `@qdrant/js-client-rest`, parsers (`pdf-parse`, `mammoth`, `exceljs`, `node-html-parser`), `bcryptjs`, `jsonwebtoken`, `nodemailer`. Notably absent: `langchain`/`llama-index` (RAG is hand-rolled), `bullmq`/`redis` (queue is in-process), rate-limit/cache libraries.

**Module layout (`backend/src/`).**

```
app.ts  index.ts
config/         env, ragConfig (Zod-validated)
routes/         auth | keys | credits | usage | conversations | rag | completions | admin
controllers/    thin HTTP adapters
services/       domain logic (auth, keys, litellm, credits, usage, admin,
                chat, conversations, rag/*, liveSearch/*, mail, otp)
models/         prisma client, rag pool/types
middleware/     auth, errorHandler, admin guard
processing/     parsers, chunker, tabularChunker, types
jobs/           ingestion.queue, purgeLegacyUsers
utils/          rag.constants, chat.constants, liveSearch.constants, roles
prisma/         schema.prisma
```

**Bootstrap (`backend/src/index.ts:12-45`).** Fail-fast sequence:

```
assertDatabaseConnection()  -- can we reach Postgres?
ensureSchema()              -- raw DDL: rag_documents/rag_chunks/conversations/messages + generated tsvector + indexes
purgeLegacyNonUuidUsers()   -- migration hygiene
bootstrapSuperadmin()       -- SUPERADMIN_EMAIL from env
markInterruptedAsFailed()   -- documents stuck in "processing" at crash -> "failed"
listen()
```

Failure at any step aborts the process  --  a half-initialised server never starts accepting requests.

**Middleware stack (`backend/src/app.ts:7-23`).** `cors({origin: env.corsOrigin})` -> `express.json({limit:"2mb"})` -> inline `GET /health` -> `registerRoutes(app)` -> `notFound` -> `errorHandler`. No `helmet`, compression, or rate limiter is currently installed  --  flagged in `remaining.md`.

**Authentication.** Stateless JWT (7-hour expiry) signed with `JWT_SECRET`; `role` and `status` are re-read from the database on every request so admin pause/block takes effect without token revocation (JWT revocation itself is open work per `remaining.md`). Passwords are `bcryptjs`-hashed. Email OTP flows (signup, login-2FA, password reset) use 6-digit codes: `codeHash = sha256(code)`, `expiresAt`, `attempts` counter, and for signup a `payload Json` holding `{passwordHash, name}` so the `User` row is created only after email proof (`schema.prisma:42-56`).

**Ingestion queue (`backend/src/jobs/ingestion.queue.ts:1-31`).** A minimal in-process FIFO:

```ts
const queue: IngestionInput[] = [];
let running = false;
export function enqueueIngestion(job: IngestionInput) { queue.push(job); if (!running) { running = true; void drain(); } }
async function drain() { while (queue.length) { const job = queue.shift()!; try { await ingestDocument(job); } catch (err) { console.error(...); } } running = false; }
```

Uploads enqueue and return immediately (`202 Accepted` semantics); a single worker drains serially so embedding load stays bounded. `pendingJobs()` exposes queue depth. No persistence  --  a crash loses queued (not yet processing) jobs, which is acceptable because the client can re-upload; in-flight jobs are marked failed at next boot.

---

### 4.9 Frontend  --  Dashboard

**Stack.** React 19.2.8, `react-router-dom` 7.18.2, Vite 8.2.0 + `@vitejs/plugin-react` 6, TypeScript ~6.0.2, Tailwind CSS 4.3.3 via `@tailwindcss/vite`, `oxlint` (`frontend/package.json`). Build: `tsc -b && vite build`; dev: `vite --port 5173`. No UI kit or state manager  --  hand-rolled components.

**Routes (`frontend/src/App.tsx`).**

| Path | Access | Purpose |
|------|--------|---------|
| `/` | public | Marketing home |
| `/signup`, `/login`, `/forgot-password` | public | Auth with OTP step component |
| `/docs` | public | API docs with `curl`/OpenAI-SDK examples, model `qwen3-30b-a3b`, `web_search` flag, `POST /v1/rag/query` example |
| `/dashboard` | protected | Credit balance, active keys, spend; key generate (revealed once with copy + inline Test), revoke list, usage table |
| `/chat` | protected | General chat shell "Harrier"  --  `AppShell` + `AppSidebar` + `MessageThread` + `Composer` with web-search toggle |
| `/test` | protected | Paste any `sk-...` key + message -> real completion with reply/latency/tokens |
| `/rag` | protected | "RAG Studio"  --  three tabs: Chats / Documents / Visual chunk browser |
| `/admin` | superadmin | User search incl. deleted, pause/unpause/block/unblock/delete/restore, per-user drill-down, revoke-all |

**RAG Studio details.** Document upload uses drag-drop, a queue of up to 3 concurrent `XMLHttpRequest` uploads with real progress bars, retry/remove/clear-completed, client-side validation (25 MB cap, `pdf/docx/txt/md/markdown`; `remaining.md` notes PPTX is rejected  --  no parser, not in `ALLOWED_UPLOAD_MIMES`). Document list polls every 2.5 s while any doc is `queued`/`processing`; badges show status. Per-conversation document scoping via a single-doc dropdown frozen at creation. RAG API keys (named, shown once, revoke, spend) are advertised for programmatic `POST /v1/rag/query`. `DocumentChunkBrowser` calls `ragListChunks` for the visual chunk view.

**API client (`frontend/src/lib/api.ts`, base `VITE_API_BASE_URL ?? http://localhost:4001`).** Covers `POST /auth/*`, `GET /auth/me`, `GET|POST /keys`, `DELETE /keys/:id`, `GET /usage`, `POST /keys/test`, `POST /credits/topup` (mock), chat/conversation endpoints, RAG document/key/query endpoints. The docs page advertises the platform's public `/v1/*` surface: `POST /v1/chat/completions` (OpenAI-compatible via LiteLLM) and `POST /v1/rag/query`.

**Shared concerns.** `AuthContext`/`ThemeContext`, `OTP` step component, `Layout`, `CodeBlock`, `KeyTestResult`. No streaming is currently implemented for completions  --  responses are returned as a single JSON payload after generation completes (RunPod proxy 100 s cap is the immediate limiter).

## 5. Cross-Cutting Data Flows

### 5.1 Identity, Key Issuance and Budget Lifecycle

**Registration and login.** `POST /auth/signup` hashes the password, generates a 6-digit OTP, stores `{codeHash, expiresAt, payload:{passwordHash,name}}` in `EmailOtp`, and sends the code via `nodemailer` (SMTP configured from `SMTP_HOST/PORT/USER/PASS`  --  Gmail `587` with `SECURE=false` in `.env.runpod.example`). `POST /auth/verify-otp` verifies the hash, creates the `User` row, and returns a JWT. Login and password reset follow the same OTP pattern; every OTP verification checks `attempts` and `expiresAt`.

**Key issuance (`backend/src/services/keys.service.ts:10-24`).**

```
createKey(userId):
  user = prisma.user.findUniqueOrThrow(userId)
  maxBudget = user.creditBalanceUsd.toNumber()   // $5.00 default, drives every key's LiteLLM max_budget
  {key, tokenId} = POST /key/generate {max_budget: maxBudget, metadata:{dashboard_user_id:userId}}  [master key]
  apiKey = prisma.apiKey.create({userId, litellmKeyId: tokenId})   // plaintext NEVER stored
  return {id: apiKey.id, key /* shown once */, createdAt}
```

**Why `maxBudget = creditBalance`.** Each key's `max_budget` in LiteLLM is set to the user's current `creditBalanceUsd`. A mock top-up (`POST /credits/topup` -> `+ $10`) raises `creditBalanceUsd` and then calls `POST /key/update {key: tokenId, max_budget: newBalance}` for every active key of that user (`backend/src/services/credits.service.ts`). There is no separate local ledger  --  LiteLLM's `spend` is the source of truth, aggregated live from `GET /spend/logs/v2` paginated at `page_size=1000` from `2020-01-01` to now (`litellm.service.ts:206-244`). The dashboard sums `spend`, `prompt_tokens`, `completion_tokens`, and request count.

**Key resolution on inference.** `findUserByPresentedApiKey(rawKey)` hashes the presented key with `sha256` and looks up `prisma.apiKey.findFirst({OR:[{litellmKeyId:hash},{litellmKeyId:rawKey}], revokedAt:null})` (`keys.service.ts:57-69`). LiteLLM's `token_id` is itself a hash of the raw key, so the stored value matches the hash without ever storing the raw key. Revocation calls `POST /key/delete {keys:[tokenId]}` and sets `revokedAt`.

**RAG keys and chat keys.** `RagKey` (`rag_keys`) stores user-facing RAG API keys (`keyHash` sha256 + `tokenId`) for `POST /v1/rag/query`. `RagChatKey` (`rag_chat_keys`, `userId @id`) stores one hidden per-user key encrypted with AES-256-GCM that is shared by both the Chat UI and RAG Studio  --  recoverable unlike user-facing keys, so the UI can reuse it without re-prompting.

---

### 5.2 Document Ingestion Pipeline

The pipeline is `parse -> chunk (format-appropriate) -> embed -> dual persist` and runs inside the in-process queue so uploads return immediately (`backend/src/services/rag/ingestion.service.ts:26-74`).

```
Client POST /rag/documents (multipart, 25 MB cap, MIME allowlist)
  -> documents.service: create rag_documents row status="queued"
  -> enqueueIngestion({userId, documentId, name, mimeType, buffer})
  -> 202 Accepted (frontend polls every 2.5 s)

Worker drain():
  updateDocumentStatus(documentId, "processing")
  try:
    extracted = extractText(mimeType, buffer)          // parsers.ts
    {chunks, documentType} = toChunks(extracted)        // dispatch by kind
    collectionName = ensureUserCollection(userId)        // lazy per-user Qdrant collection
    vectors = embedInBatches(chunks)                     // EMBED_BATCH_SIZE=32 -> POST /embed
    chunkIds = chunks.map(() => randomUUID())
    insertChunks(documentId, name, chunks, chunkIds)     // Postgres rag_chunks
    upsertPoints(collectionName, chunks.map((c,i)=>{id:chunkIds[i], vector:vectors[i], documentId, documentType?}))
    updateDocumentStatus(documentId, "indexed", null, chunks.length)
  catch (err):
    updateDocumentStatus(documentId, "failed", message)
    deleteChunksByDocument(documentId)   // drop partial rows so retries start clean
    throw
```

**Parsing (`backend/src/processing/parsers.ts`).**

| MIME | Library | Output kind | Notes |
|------|---------|-------------|-------|
| `application/pdf` | `pdf-parse` | `text` | Whole-document text; no page markers  --  `page: null` for all chunks; scanned PDFs produce no text (OCR is open work) |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `mammoth` (HTML) | `structured` (`StructuredBlock[]`) | Real headings/tables/lists preserved  --  drives `chunkStructuredBlocks` directly |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `exceljs` | `tabular` (`{sheets: {name, rows}[]}`) | Row-per-chunk via `chunkTabularSheets` |
| `text/plain`, `text/markdown` | raw read | `text` | Flat text |

PPTX is rejected outright  --  no parser and not in `ALLOWED_UPLOAD_MIMES` (`backend/src/utils/rag.constants.ts:44-50`).

**Chunking  --  two strategies, one packing discipline.**

*Flat-text path* (`chunkDocument`, `backend/src/processing/chunker.ts:61-67`) for PDF/TXT/MD  --  a heading tree is inferred via regex heuristics:

* Markdown ATX headings (`#`/`##`/...) 
* Numbered headings (`1.`, `1.1.`, `1.2.3`)
* Standalone `ALL-CAPS` lines
* **Definition clauses**  --  Indian statutes define terms as `(a) "term" means ..., (b) "other" means ...`. `pdf-parse` extracts an entire definitions list as one continuous run with ~2 newlines total. `splitEmbeddedDefinitionClauses` (`chunker.ts:88-111`) inserts real newlines before each detected clause `^\(([a-z]{1,3}|[ivxlcdm]{1,6})\)\s*[""]([^""]{1,80})[""]\s+means\b` at level 10 (deep, always nests under the real section heading) so the per-line heading machinery can see each definition as a separate section. This directly fixed a verified failure where the LLP Act's real "Tribunal" definition was diluted by unrelated definitions packed into the same chunk and never surfaced by retrieval.

Content under the current section groups into chunks of up to `MAX_CHUNK_CHARS=800` (`MIN_CHUNK_CHARS=200`), splitting only between paragraphs so sentences are never cut. Tables (lines with `|` or tab separators) stay whole; only a single oversized table is hard-split with `MAX_OVERLAP_CHARS=120` overlap. Sections matching `JUNK_SECTION_HEADINGS` (`notes`, `references`, `bibliography`, `works cited`, etc.  --  `rag.constants.ts:81-92`) are dropped entirely to prevent reference pages from outranking title pages. Each chunk carries `headingPath: string[]`, `page: number|null`, `tokenCount`, `content`.

*Structured path* (`chunkStructuredBlocks`, `chunker.ts:118-...`) for DOCX  --  reuses the same junk filtering and `assembleChunks` packing but from real `StructuredBlock` headings/tables instead of guessing.

*Tabular path* (`chunkTabularSheets`, `backend/src/processing/tabularChunker.ts`)  --  one chunk per spreadsheet row, tagged `documentType="tabular"` in the Qdrant payload.

**Embedding and dual persist.** `embedInBatches` slices `chunks.map(c=>c.content)` into batches of `EMBED_BATCH_SIZE=32` and calls `embedDocuments` -> `POST /embed` (`ingestion.service.ts:105-114`). Length mismatch throws. Chunk IDs are `randomUUID()` v4, shared between Postgres and Qdrant so deletion can correlate. `insertChunks` writes to `rag_chunks`; `upsertPoints` writes to the user's Qdrant collection with the same IDs and optional `document_type`. The document is marked `indexed` with `chunkCount`.

---

### 5.3 Retrieval Pipeline  --  Hybrid Search, Fusion, Reranking, Token-Budget Walk

This is the most intricate subsystem (`backend/src/services/rag/retrieval.service.ts:1-275`). Its evolution is documented comment-by-comment with the incidents that forced each current choice.

**Overview.**

```
retrieve({userId, query, documentIds?, reservedTokens}):
  queryVector = embedQueries([query])[0]          // POST /embed/query (asymmetric)
  parallel:
    vectorHits  = searchChunks({collection: rag_user_${userId}, vector: queryVector, limit:24, documentIds?})
    keywordHits = keywordSearchChunks({userId, query, limit:24, documentIds?})  // Postgres FTS
  fused    = fuseRankings(vectorHits, keywordHits)   // RRF K=60
  strong   = fused.filter(hit => hit.keywordRank !== undefined || hit.vectorScore >= 0.25)
  if strong empty -> return []
  chunksById = getChunksByIds(strong.map(h=>h.chunkId))      // one indexed query
  rerankScores = rerankChunks(query, strong.map(...content))  // POST /rerank, sigmoid, best-effort
  ordered = rerankScores ? strong sorted by rerankScores desc : strong
  walk ordered best-first, counting tokens via POST /tokenize:
    budget = MODEL_MAX_CONTEXT_TOKENS - reservedTokens - OUTPUT_TOKEN_RESERVE(300)
    for hit in ordered:
      candidate = {chunkId, documentId, source, page, headingPath, excerpt: truncate(content,800), score}
      candidateTokens = countTokens(formatCitation(index, candidate))
      if citations.length>0 && used+candidateTokens > budget: break  // never skip ahead
      citations.push(candidate); used += candidateTokens   // always keep >=1
  return citations
```

**Dense leg.** `searchChunks` queries the user's Qdrant collection with cosine similarity. `limit=CANDIDATE_POOL_SIZE=24` is intentionally generous  --  deep enough that a chunk ranked outside the vector top-k but strong in keyword still survives to fusion (`retrieval.service.ts:42`). An optional `documentIds` filter (`match:{any: documentIds}`) scopes to a single document when the conversation was created with a document scope.

**Sparse leg.** `keywordSearchChunks` (SQL above) uses `to_tsquery('english', replace(plainto_tsquery('english',$2)::text,' & ',' | '))` and `ts_rank_cd` (see Section 4.6). Tenancy is via `JOIN rag_documents`. The `& -> |` conversion is the fix for a verified incident: AND semantics matched nothing on natural-language questions against 800-char chunks (zero rows on every test query before the fix).

**Fusion  --  Reciprocal Rank Fusion (RRF).**

For each hit appearing at rank `r` (1-indexed) in a leg:

```
rrf(hit) = sum over legs containing hit of  1 / (K + r)    where K = 60
```

`K=60` is the standard constant from Cormack et al., chosen to sidestep normalising cosine similarity against `ts_rank_cd`  --  the two scores live on incomparable scales. `MAX_RRF_SCORE = 2/(K+1) = 2/61` is the best case (rank 1 in both legs) and is used to normalise `rrf / MAX_RRF_SCORE` into `[0,1]` for the `Citation.score` display when reranking is unavailable (`retrieval.service.ts:41-43,227`).

Fused hits are sorted descending by `rrfScore`. A weak-vector filter then applies: a chunk is dropped only if it came *exclusively* from the vector leg and its raw cosine is `< MIN_RETRIEVAL_SCORE=0.25` (`retrieval.service.ts:161-165`). A keyword match is its own strong relevance signal and is never filtered by the cosine threshold  --  this is exactly the case hybrid search exists to rescue.

Why hybrid at all: pure dense search under-ranked exact defined terms and section numbers in statutory text. Verified: the correct "Tribunal" definition (Section 408) never made vector's shallow top-k, while a similar-sounding wrong section (410, "Appellate Tribunal") did. Keyword search surfaces literal-term matches that dense search misses; fusion keeps the strengths of both.

**Hydration.** `getChunksByIds` fetches every surviving candidate's content in one indexed query. Real content is needed both to measure real token cost and to rerank (which reads text).

**Cross-encoder reranking.** RRF is a coarse, rank-only signal  --  it never reads chunk text against the query. Verified: a chunk containing the complete, literal correct answer (but diluted by unrelated definitions in the same chunk) ranked behind denser-but-unanswering chunks in the fused order. `rerankChunks` re-scores every surviving candidate by feeding `(query, chunk)` jointly through the cross-encoder (`reranker.service.ts:21-53`). Scores are `sigmoid` logits in `[0,1]`; ordered hits are sorted descending by reranker score. On any failure (service down, length mismatch) the function returns `null` and the caller falls back to the untouched fused order  --  a precision-only enhancement never fails the request.

Post-reranking, `CANDIDATE_POOL_SIZE` is effectively the limiter: reranking sends nearly every retrieved candidate to the LLM, diluting precision. A follow-up to cap at explicit top-8-10 post-rerank is noted in `remaining.md`.

**Token-budget walk.** `chunkTokenBudget = MODEL_MAX_CONTEXT_TOKENS - reservedTokens - OUTPUT_TOKEN_RESERVE` (`retrieval.service.ts:194-195`). `MODEL_MAX_CONTEXT_TOKENS` mirrors `VLLM_MAX_MODEL_LEN` (2,048 locally); `OUTPUT_TOKEN_RESERVE=300` reserves headroom so LiteLLM's `max_model_len - input_tokens` remaining-output budget is not starved. `reservedTokens` is measured by the caller (see Sections 5.5-5.6) as `systemTokens + wrapperTokens + historyTokens + webContextTokens` with real BPE counts. The walk counts `formatCitation(n, candidate)` tokens via `countTokens` (vLLM `/tokenize`) per candidate actually considered  --  typically single digits before the first overflow, so no batching is needed (and the endpoint does not support it). An excerpt is truncated to `MAX_CHUNK_CHARS=800`, not a smaller arbitrary cap  --  chunks are already bounded at ingestion, but the previous hardcoded 500-char cap was verified to cut the LLP Act's answering sentence off mid-chunk, causing the model to honestly (and wrongly) claim the documents did not contain the answer.

**Deletion.** `deleteDocument(userId, id)` soft-deletes the Postgres row and best-effort deletes `rag_chunks` rows and Qdrant points via `Promise.allSettled`  --  the Postgres row is already soft-deleted, so vector orphans are harmless (`retrieval.service.ts:246-259`).

---

### 5.4 Token Accounting

`countTokens(text)` (`tokenizer.service.ts:18-29`) calls `POST ${VLLM_BASE_URL}/tokenize {model, prompt: text}` and returns `{count}`. This is the *only* place the backend calls vLLM directly  --  a deliberate, narrow exception justified as a stateless vocabulary lookup that does not touch spend/budget tracking. The prior approach via LiteLLM's `/utils/token_counter` silently under-counted by ~15% on realistic text because it fell back to a generic `openai_tokenizer` for self-hosted models, risking silent context-overflow bugs.

System-prompt token counts are cached per process lifetime (`rag/chat.service.ts:64-79`, two variants with/without the web-search addendum)  --  if the prompt wording ever changes, the next restart re-measures automatically.

`trimHistoryToTokenBudget(history, budget)` (`tokenizer.service.ts:43-59`) walks history newest-first, counting each turn's content, stopping at the first turn that would exceed the budget, and returns the kept turns oldest-first  --  whole-turn-in or whole-turn-out, never truncated mid-message. RAG history budget is `RAG_HISTORY_TOKEN_BUDGET=250` (small  --  retrieved chunks are the primary value and must not be starved in a 2,048-token window); general chat is `CHAT_HISTORY_TOKEN_BUDGET=1200`.

---

### 5.5 Context Assembly and Generation

**RAG answer (`backend/src/services/rag/chat.service.ts:81-173`).**

```
answerQuestion({userId, question, apiKey, documentIds?, history?, webSearch?}):
  webSearch = webSearch ?? false
  systemTokens  = countTokens(SYSTEM_PROMPT [+ WEB_SEARCH_ADDENDUM if webSearch])
  wrapperTokens = countTokens("Context:\n\n\nQuestion:\n${question}")
  trimmedHistory = trimHistoryToTokenBudget(history ?? [], RAG_HISTORY_TOKEN_BUDGET=250)
  historyTokens  = countTokens(trimmedHistory.map(h=>h.content).join("\n")) if any
  webCitations   = webSearch ? getLiveSearchContext({query:question, budgetTokens: LIVE_SEARCH_TOKEN_BUDGET_WITH_RAG}) : []
  webContextTokens = webCitations.length ? countTokens(formatWebContext(webCitations)) : 0
  reservedTokens = systemTokens + wrapperTokens + historyTokens + webContextTokens
  citations      = retrieve({userId, query:question, documentIds, reservedTokens})
  if citations.empty && webCitations.empty -> return refusal (no LLM call)
  docContext = citations.length ? formatContext(citations) : ""           // numbered [1],[2],...
  webContext = webCitations.length ? formatWebContext(webCitations, citations.length) : ""  // continues numbering
  context    = [docContext, webContext].filter(Boolean).join("\n\n")
  completion = completeChat(apiKey, [
    {role:"system", content: SYSTEM_PROMPT [+ WEB_SEARCH_ADDENDUM]},
    ...trimmedHistory,
    {role:"user", content: "Context:\n${context}\n\nQuestion:\n${question}"}
  ])
  return {answer: completion.content, citations, webCitations: webSearch?webCitations:undefined, usage}
```

`SYSTEM_PROMPT` is a strict grounding contract: answer using *only* facts explicitly stated in the numbered chunks, never fill gaps from general knowledge, trust higher-match chunks, do not blend details across sections covering different provisions, say plainly when the context does not support an answer, name exact section/clause numbers as they appear (never invent or round), and treat citation/reference entries as non-answers (`chat.service.ts:16-42`). `WEB_SEARCH_ADDENDUM` additively widens this to allow live web citations marked `[n] (web)` alongside document chunks, keeping the two sources distinct in reasoning.

`formatCitation(n, citation)` and `formatContext(citations)` (`citationFormat.ts`) render each citation as a numbered block with source, heading path, page, excerpt and score. `formatWebContext` does the same for web citations, continuing numbering after document citations so the model's `[n]` scheme is a single sequence across both sources.

**General chat (`backend/src/services/chat.service.ts:31-83`).**

```
answerChatMessage({apiKey, question, history, webSearch?}):
  webCitations = webSearch ? getLiveSearchContext({query:question, budgetTokens: LIVE_SEARCH_TOKEN_BUDGET_STANDALONE}) : []
  webContextTokens = webCitations.length ? countTokens(formatWebContext(webCitations)) : 0
  historyBudget = max(0, CHAT_HISTORY_TOKEN_BUDGET(1200) - webContextTokens)  // web results reallocate, not expand, the fixed ceiling
  trimmedHistory = trimHistoryToTokenBudget(history, historyBudget)
  messages = [{role:"system", content: SYSTEM_PROMPT_HARRIER}]
  if webCitations.length: messages.push({role:"system", content: "Live web search results...\n${formatWebContext(webCitations)}\n..."})
  messages.push(...trimmedHistory, {role:"user", content: question})
  completion = completeChat(apiKey, messages)
  return {answer, webCitations, usage}
```

The Harrier system prompt is a brief helpful-assistant persona, not the strict document-grounding contract.

**Completion call (`backend/src/services/rag/completion.service.ts:30-68`).**

```ts
POST ${LITELLM_BASE_URL}/v1/chat/completions
  Authorization: Bearer ${apiKey}   // caller-supplied key, NEVER the master key  --  spend attributed to that key
  body: {model: ragConfig.chatModel, messages}
-> {choices:[{message:{content}}], usage:{prompt_tokens, completion_tokens, total_tokens}}
```

Errors are wrapped as `CompletionError(status, message)` and mapped by `mapCompletionErrorStatus`: 401->401, 402/429->402 (budget exhausted), else 502 (`completion.service.ts:70-77`). Controllers share this mapping so the HTTP surface is consistent.

---

### 5.6 Live Web Augmentation

Live search is **explicit opt-in only**  --  the `webSearch` boolean is passed from the frontend's composer toggle or `POST /v1/rag/query {web_search:true}`. Automatic triggering is deliberately not implemented: the model is too small to reliably decide on its own when it needs current information, and auto-triggered searches would add latency and cost on every turn (`backend/src/services/rag/chat.service.ts:90-93` comment).

**Orchestration (`backend/src/services/liveSearch/liveSearch.service.ts:14-56`).**

```
getLiveSearchContext({query, budgetTokens}):
  results = searchWeb(query, LIVE_SEARCH_CANDIDATE_POOL)   // SearXNG JSON, may throw -> return []
  if results empty -> return []
  fetched = Promise.allSettled(results.map(r => fetchPageText(r.url)))  // each independent, slow/failed fetch does not block others
  candidates = results.map((r,i) => {title:r.title, url:r.url, excerpt: fetched[i].fulfilled ? pageText : r.snippet})
                       .filter(c => c.excerpt.trim().length > 0)
  // token-budget walk  --  same discipline as retrieval: best-first (SearXNG relevance), stop at first overflow, always keep >=1
  citations=[]; used=0;
  for candidate in candidates:
    tokens = countTokens(formatWebCitation(citations.length, candidate))
    if citations.length>0 && used+tokens > budgetTokens: break
    citations.push(candidate); used+=tokens
  return citations
```

**Search (`search.service.ts:10-38`).** `GET ${SEARXNG_BASE_URL}/search?q=${query}&format=json` -> `{results:[{title,url,content}]}` (limited to `LIVE_SEARCH_CANDIDATE_POOL`). SearXNG is a live metasearch relay  --  each call fans out to upstream engines and returns merged results, so there is nothing to keep fresh locally.

**Page fetch (`fetchPage.service.ts`).** Fetches each result's real page text in parallel. A failed or slow fetch falls back to the SERP snippet (`content`) for that result.

**Budgets.** `LIVE_SEARCH_TOKEN_BUDGET_WITH_RAG` (RAG augmentation) and `LIVE_SEARCH_TOKEN_BUDGET_STANDALONE` (general chat) are separate constants (`backend/src/utils/liveSearch.constants.ts`). In RAG, web context tokens are folded into `reservedTokens` *before* `retrieve()` is called, so the dense+keyword token walk knows the true ceiling upfront. In general chat, web context shrinks the history budget rather than expanding the total  --  stacking web search on a long conversation cannot blow past the tested allocation.

**Formatting.** `formatWebCitation(n, citation)` and `formatWebContext` (`webCitationFormat.ts`) mirror the document citation formatters so token measurement is accurate before final numbering is known (RAG merges web after document citations).

## 6. Interaction Matrix and Interface Contracts

| Caller | Callee | Protocol | Endpoint / Contract | Auth | Purpose |
|--------|--------|----------|---------------------|------|---------|
| Browser | Frontend | HTTP | `5173` Vite dev server |  --  | UI shell |
| Frontend | Backend | REST JSON | `4001` `VITE_API_BASE_URL` | JWT Bearer | All dashboard operations |
| Backend | LiteLLM | REST JSON | `4000` `/key/*`, `/v1/chat/completions`, `/spend/logs/v2` | Master key (admin) or caller key (inference) | Key lifecycle + inference |
| LiteLLM | vLLM | REST JSON | `8000` `/v1/*` (`http://vllm:8000/v1` in Docker) | `not-needed` | Model inference |
| Backend | vLLM | REST JSON | `8000` `POST /tokenize` | none | Token counting only |
| Backend | Embedding | REST JSON | `8002` `POST /embed`, `POST /embed/query`, `POST /rerank`, `GET /health` | none (private network) | Vectors + reranking |
| Backend | Qdrant | REST JSON | `6333` `client.query / upsert / delete` (JS client) | none (private network) | Vector storage |
| Backend | PostgreSQL | SQL | `5432` Prisma + `pg.Pool` | `POSTGRES_USER/PASSWORD` | Identity + RAG metadata + FTS |
| LiteLLM | PostgreSQL | SQL | `5432` `DATABASE_URL` to DB `litellm` via `host.docker.internal` | same creds | Key/budget/spend persistence |
| Backend | SearXNG | REST JSON | `8888->8080` `GET /search?q=&format=json` | none | Live search |
| Backend | SearXNG result hosts | HTTP | `fetchPageText(url)` per result | none | Page body extraction |
| Backend | SMTP | SMTP | `SMTP_HOST:PORT` | `SMTP_USER/PASS` | OTP email delivery |

The critical invariant is that **every inference call goes through LiteLLM**  --  the backend never calls vLLM for completions, preserving per-key budget enforcement. The sole exception is `POST /tokenize`, which is a stateless vocabulary lookup.

---

## 7. Failure Semantics and Degradation Ladder

The platform is designed to degrade gracefully rather than fail hard when a non-critical dependency is unavailable.

| Failure | Detection | Behaviour | User-visible effect |
|---------|-----------|-----------|---------------------|
| vLLM down | `litellmFetch` throws; LiteLLM health fails | LiteLLM returns 5xx; backend maps to 503/502 with actionable message (`litellm.service.ts:20-36`) | Chat/RAG completions fail with "Cannot reach LiteLLM" |
| LiteLLM down | `litellmFetch` catch | `AppError 503` | All key operations and completions fail |
| Embedding service down | `fetch` to `8002` rejects | `ingestDocument` marks document `failed`; `retrieve` throws (no fallback for embedding  --  retrieval cannot proceed without query vector) | Uploads fail; queries fail if embedding is needed |
| Reranker down | `rerankChunks` catch | Returns `null`; `retrieve` falls back to fused RRF order (`retrieval.service.ts:188-192`) | Retrieval succeeds with slightly lower precision |
| Qdrant down | `client.getCollections()` / `query` rejects | `pingQdrant` fails at boot (non-fatal for some paths); `searchChunks` 404->`[]` vs other errors throw | Vector leg returns no results; keyword leg may still return results if Postgres is up |
| Qdrant collection missing | 404 from `query` | `searchChunks` returns `[]` (`qdrant.service.ts:144-149`) | Treated as zero results, not an error |
| PostgreSQL down | `assertDatabaseConnection` at boot; `pool.query` rejects at runtime | Boot aborts; runtime queries throw 500 | All operations fail |
| SearXNG down | `searchWeb` throws | `getLiveSearchContext` catches, logs, returns `[]` (`liveSearch.service.ts:20-24`) | Web augmentation silently absent; document-grounded answer still returned |
| Single page fetch fails | `Promise.allSettled` per-result | Falls back to SERP snippet for that result | No effect on other results |
| vLLM `/tokenize` fails | `fetch` rejects | `countTokens` throws | Retrieval/generation fails (no safe fallback count) |
| SMTP down | `nodemailer` send fails | OTP request fails with 500 | Signup/login OTP delivery fails |

The design philosophy is that **precision enhancements** (reranking, live search) degrade to the baseline, while **correctness-critical** steps (embedding for retrieval, token counting for budget) fail loudly rather than silently producing wrong results.

---

## 8. Security and Multi-Tenancy Model

### 8.1 Tenancy Enforcement

* **Vector isolation** is structural: each user gets a separate Qdrant collection `rag_user_${userId}`. No filter bug can leak cross-tenant vectors.
* **Relational isolation** is via `WHERE d.user_id = $1` joins (keyword search) and `WHERE user_id = $1` predicates on `rag_documents`/`conversations`. `rag_chunks` has no `user_id` column  --  isolation is inherited through the document join.
* **Key isolation**: `findUserByPresentedApiKey` and RAG key lookups are by hashed key material, scoped to the authenticated user for management operations (revoke checks `apiKey.userId !== userId`).
* **Conversation scope**: `documentIds` is frozen at `Conversation` creation and never mutated, preventing scope escalation after the fact.
* **Collection name safety**: `userId` is always server-resolved from JWT or from a trusted key lookup  --  never from request body/params  --  so `collectionNameForUser` cannot be pointed at an attacker-chosen collection.

### 8.2 Authentication and Authorisation

* JWT is stateless with 7-hour expiry; `role` and `status` are re-read from the DB on every request so admin pause/block takes effect without waiting for token expiry.
* Passwords are `bcryptjs`-hashed. OTP codes are `sha256`-hashed with `expiresAt` and `attempts` counters.
* `isAdmin` legacy column is retained only to avoid `prisma db push` drift  --  `role` is the canonical field.
* Per-route guards: `authMiddleware` (JWT), `adminGuard` (superadmin role), `accountStatus` checks (`active` vs `paused`/`blocked`).

### 8.3 Known Gaps (from `remaining.md` and `rag-accuracy-improve.md`)

| Gap | Status | Notes |
|-----|--------|-------|
| SSRF guard on page fetching (incl. redirect re-checks) | Open | `fetchPageText` currently fetches arbitrary URLs from SearXNG results |
| Prompt-injection framing for web content (3 call sites) | Open | Web excerpts are injected into prompts without explicit untrusted-content delimiters |
| Zip-bomb / decompression cap on DOCX/XLSX | Open | `mammoth`/`exceljs` parse without size caps beyond the 25 MB upload limit |
| Rate limiting | Absent everywhere | No `express-rate-limit` or equivalent is installed |
| JWT revocation | Open | Tokens are stateless until expiry; logout cannot invalidate them server-side |
| Helmet / compression / CORS tightening | Open | `app.ts` has minimal middleware |
| `npm audit` hygiene | Periodic |  --  |

---

## 9. Empirical Design Decisions

Every non-obvious constant in the codebase is accompanied by a comment documenting the incident that motivated it. The table below distils those into a single reference.

| Decision | Value | Incident / Verification | Location |
|----------|-------|------------------------|----------|
| Fixed candidate count for retrieval | `CANDIDATE_POOL_SIZE=24` | Shallow top-k missed correct chunks; 24 is generous enough for keyword hits to survive fusion | `retrieval.service.ts:42` |
| RRF constant | `K=60` | Standard Cormack et al. value; avoids normalising incomparable score scales | `retrieval.service.ts:41` |
| Cosine threshold | `MIN_RETRIEVAL_SCORE=0.25` | Paraphrase-MiniLM scores relevant chunks well above 0.25, unrelated below | `rag.constants.ts:74` |
| Chunk size | `MAX_CHUNK_CHARS=800`, `MIN=200`, overlap `120` (hard-split only) | Large chunks dilute embeddings and let reference pages outrank content; 800 chars ~200 tokens is a tight semantic unit | `rag.constants.ts:36-40` |
| Excerpt cap | `MAX_CHUNK_CHARS` (800), was 500 | Hardcoded 500 cut the LLP Act's answering sentence mid-chunk; model then correctly said "not in documents" because the excerpt it saw was truncated | `retrieval.service.ts:218-226` |
| AND -> OR in FTS | `replace(plainto_tsquery(...)::text,' & ',' \| ')` | AND semantics matched zero rows on every NL question (12-16 stemmed terms vs 800-char chunks) | `retrieval.service.ts:49-62` |
| `ts_rank_cd` over `ts_rank` | cover density | Better for passage-length text where term clustering matters | `retrieval.service.ts:58-59` |
| Token counting via vLLM `/tokenize` | direct call | LiteLLM's `/utils/token_counter` under-counted by ~15% via generic tokenizer  --  risked silent overflow | `tokenizer.service.ts:5-10` |
| Token-budget walk (not fixed count) | `budget = MODEL_MAX_CONTEXT - reserved - 300` | `limit=12` overflowed 2,048 window on 100% of test queries | `retrieval.service.ts:36-39,194-195` |
| Definition-clause splitting | regex `...means\b` at level 10 | Entire LLP Act definitions list extracted as one run with 2 newlines; correct definition never surfaced even after reranking | `chunker.ts:69-111` |
| Reranking as second stage | cross-encoder over fused candidates | Correct chunk diluted by unrelated definitions ranked behind denser-but-unanswering chunks in fused order alone | `retrieval.service.ts:172-180` |
| Best-effort reranker fallback | return `null` -> fused order | Precision enhancement must not fail the request | `reranker.service.ts:50-53` |
| `EMBEDDING_GPU_MIN_FREE_MB=1536` | threshold | Protects 4 GB card where vLLM holds ~3 GB; auto-selects CPU below threshold | `embedder.py:80-111` |
| vLLM `--enforce-eager` | enabled | CUDA graphs cost extra memory and are fragile under WSL2 | `docker-compose.yml:39` |
| Qdrant per-user collections | `rag_user_${userId}` | Filter-only isolation is fragile; structural isolation is not | `qdrant.service.ts:6-15` |
| In-process FIFO queue (single worker) | serial drain | Bounds embedding load; uploads return immediately | `jobs/ingestion.queue.ts:1-31` |

---

## 10. Limitations and Future Work

Items are drawn from `remaining.md` (backlog updated 2026-08-17) and `rag-accuracy-improve.md` (RAG accuracy plan), ordered by tractability where noted.

**Already shipped (2026-08-17).**

* Cross-encoder reranking (`embedding/app/reranker.py` + `backend/src/services/rag/reranker.service.ts`): verified LLP Act "Tribunal" decoy scores 0.93 vs 0.63/0.88; live citations now 0.88-0.98 vs old scattered 37-80%.
* Excerpt truncation fix: 500 -> 800.
* Layers 1-2 of the accuracy plan: definition-clause regex patch and contextual chunking groundwork that fixed a verified production failure.

**Open  --  RAG quality.**

* Candidate pool as limiter post-rerank: `CANDIDATE_POOL_SIZE=24` now sends nearly everything retrieval finds, diluting precision; follow-up is an explicit top-8-10 cap after rerank (~30-45 min).
* Query rewriting for conversational follow-ups: only the latest message is embedded  --  follow-up questions that depend on prior context are under-retrieved.
* Retrieval evaluation harness: `recall@k` / MRR over a labelled set to make tuning measurable.
* Contextual chunking (Anthropic contextual-retrieval style per-chunk context blurb).
* Faithfulness checking: motivated by live evidence of correct content with a fabricated citation `section 12(13)` vs real `5(13)`.
* Document versioning: re-upload currently soft-deletes the old row; explicit version history is open.
* OCR fallback for scanned PDFs (largest/least certain item  --  Tesseract.js + rasterisation).
* Real PDF structure via font size/weight + outline/bookmarks; multi-column layout handling; table detection in PDFs; PPTX parser.

**Open  --  platform.**

* SSRF guard, prompt-injection framing, zip-bomb caps, rate limiting, JWT revocation  --  see Section 8.3.
* Long-conversation and cross-conversation memory: rolling summarisation, retrieval over past turns, user-keyed preference memory table + system-prompt injection. Biggest item; needs a design pass. Current budgets: `RAG_HISTORY_TOKEN_BUDGET=250`, `CHAT_HISTORY_TOKEN_BUDGET=1200`, newest-first silent drop.
* Streaming completions: currently single JSON payloads; verification under the RunPod 100 s proxy cap is open work.
* `CANDIDATE_POOL_SIZE` / `LIVE_SEARCH_CANDIDATE_POOL` tuning as the prompt and model change.

---

## 11. Conclusion

Kavach-AI demonstrates that a fully self-hosted, multi-tenant RAG platform can be built from composable open-source primitives without surrendering data residency or cost control. vLLM provides the inference substrate; LiteLLM provides the economic control plane; fastembed/ONNX Runtime provides the vector substrate with hardware-adaptive execution; Qdrant and PostgreSQL provide complementary dense and sparse retrieval; SearXNG provides live augmentation; and a deliberately small, hand-rolled backend ties them together with strict token accounting and structural tenancy guarantees. The system's most distinctive property is not any single component but the set of empirically grounded choices  --  from `& -> |` in the FTS query to the definition-clause newline insertion  --  that were forced by verified failures on real documents and are now encoded as invariants in the code. The architecture supports two deployment extremes (a 4 GB laptop and a 48 GB pod) with no code changes, and degrades gracefully when any non-critical dependency is unavailable.

---

## Appendix A  --  Port Map

| Port | Service | Container / Host | Protocol |
|------|---------|-----------------|----------|
| 5173 | Frontend (Vite) | host (`frontend: npm run dev`) / pod `vite preview` | HTTP |
| 4001 | Backend (Express) | host (`backend: npm run dev`) / pod `node dist/index.js` | HTTP |
| 4000 | LiteLLM | Docker `litellm:4000` / pod `:4000` | HTTP |
| 8000 | vLLM | Docker `vllm:8000` / pod `:8000` | HTTP |
| 8002 | Embedding (+ reranker) | Docker `embedding:8002` / pod `uvicorn 127.0.0.1:8002` | HTTP |
| 6333 | Qdrant | Docker `qdrant:6333` / pod `:6333` | HTTP |
| 5432 | PostgreSQL | host service / pod `postgres:5432` | TCP |
| 8888 | SearXNG | Docker `searxng:8080->8888` | HTTP |
| 8889 | SearXNG (pod) | pod `searxng:8889` (8888 taken by Jupyter) | HTTP |

Browser path: `5173 -> 4001 -> 4000 (LiteLLM) -> 8000 (vLLM)` on the compose network. Host Postgres is reached at `host.docker.internal:5432` from Docker.

---

## Appendix B  --  Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| `MAX_CHUNK_CHARS` | 800 | `backend/src/utils/rag.constants.ts:36` |
| `MIN_CHUNK_CHARS` | 200 | `rag.constants.ts:37` |
| `MAX_OVERLAP_CHARS` | 120 (hard-split only) | `rag.constants.ts:40` |
| `EMBED_BATCH_SIZE` | 32 | `rag.constants.ts:56` |
| `MAX_UPLOAD_BYTES` | 25 MiB | `rag.constants.ts:42` |
| `ALLOWED_UPLOAD_MIMES` | pdf, docx, xlsx, txt, md | `rag.constants.ts:44-50` |
| `MODEL_MAX_CONTEXT_TOKENS` | `env.modelMaxContextTokens` (2,048 local / 131,072 pod) | `rag.constants.ts:62` |
| `OUTPUT_TOKEN_RESERVE` | 300 | `rag.constants.ts:69` |
| `MIN_RETRIEVAL_SCORE` | 0.25 | `rag.constants.ts:74` |
| `RRF_K` | 60 | `retrieval.service.ts:41` |
| `CANDIDATE_POOL_SIZE` | 24 | `retrieval.service.ts:42` |
| `MAX_RRF_SCORE` | `2/(60+1) = 2/61` | `retrieval.service.ts:43` |
| `RAG_HISTORY_TOKEN_BUDGET` | 250 | `backend/src/utils/chat.constants.ts` |
| `CHAT_HISTORY_TOKEN_BUDGET` | 1200 | `chat.constants.ts` |
| `EMBEDDING_DIM` | 384 | `embedding/app/main.py` / `rag.constants.ts:21` |
| `EMBEDDING_MODEL` | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | `docker-compose.yml:100` |
| `RERANKER_MODEL` | `Xenova/ms-marco-MiniLM-L-6-v2` | `embedding/app/main.py` |
| `EMBEDDING_GPU_MIN_FREE_MB` | 1536 | `docker-compose.yml:104` |
| `VLLM_GPU_MEMORY_UTILIZATION` | 0.70 local / 0.75 pod | `docker-compose.yml:36` / `.env.runpod.example` |
| `VLLM_MAX_MODEL_LEN` | 2048 local / 131072 pod | `docker-compose.yml:37` |
| `VLLM_MAX_NUM_SEQS` | 4 local / 8 pod | `docker-compose.yml:38` |

---

## Appendix C  --  Public API Surface

All routes are mounted by `backend/src/routes/index.ts:11-20` (`/auth`, `/keys`, `/credits`, `/usage`, `/conversations`, `/admin`, plus `ragRouter` and `completionsRouter` at root). Representative surface:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/auth/signup` | none | Register + send OTP |
| `POST` | `/auth/verify-otp` | none | Verify OTP, create user, return JWT |
| `POST` | `/auth/login` | none | Login (may require OTP 2FA) |
| `POST` | `/auth/forgot-password` | none | Send reset OTP |
| `POST` | `/auth/reset-password` | none | Verify OTP + set new password |
| `GET` | `/auth/me` | JWT | Current user profile |
| `GET` | `/keys` | JWT | List user's chat API keys |
| `POST` | `/keys` | JWT | Generate key (shown once) |
| `DELETE` | `/keys/:id` | JWT | Revoke key |
| `POST` | `/keys/test` | JWT | Test any `sk-...` key with a prompt |
| `GET` | `/usage` | JWT | Per-key spend/tokens (live from LiteLLM) |
| `POST` | `/credits/topup` | JWT | Mock +$10 top-up (raises all key budgets) |
| `POST` | `/v1/chat/completions` | API key | OpenAI-compatible completions (proxied via LiteLLM) |
| `POST` | `/rag/documents` | JWT | Upload document (multipart) |
| `GET` | `/rag/documents` | JWT | List documents with status |
| `DELETE` | `/rag/documents/:id` | JWT | Soft-delete + vector cleanup |
| `GET` | `/rag/documents/:id/chunks` | JWT | Visual chunk browser |
| `POST` | `/rag/keys` | JWT | Generate RAG API key |
| `POST` | `/v1/rag/query` | RAG key | Programmatic RAG query `{query, document_ids?, web_search?}` |
| `GET/POST` | `/conversations` | JWT | Chat/RAG conversation CRUD |
| `POST` | `/conversations/:id/messages` | JWT | Send message (RAG or general) with optional `web_search` |
| `GET` | `/admin/users` | superadmin | User search incl. deleted |
| `POST` | `/admin/users/:id/{pause,block,delete,restore}` | superadmin | Account actions |
| `POST` | `/admin/keys/:id/revoke` | superadmin | Revoke any key |
| `GET` | `/health` | none | Liveness |

The frontend docs page (`/docs`) advertises the `/v1/*` surface with `curl` and OpenAI-SDK examples, model `qwen3-30b-a3b`, and the `web_search` extra-body flag.

---

## Appendix D  --  Environment Variables

**Root `.env.example` (local hybrid).**

| Variable | Default | Meaning |
|----------|---------|---------|
| `POSTGRES_USER/PASSWORD/PORT` | `postgres / change-me / 5432` | Host Postgres creds |
| `QDRANT_PORT` | 6333 | Published Qdrant port |
| `SEARXNG_PORT` | 8888 | Host -> container 8080 |
| `EMBEDDING_PORT` | 8002 | Published embedding port |
| `EMBEDDING_MODEL` | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | HF model id |
| `EMBEDDING_DIM` | 384 | Vector dimension |
| `EMBEDDING_PROVIDER` | `cpu` (local) / `auto` (pod) | `cpu` `cuda` `auto` |
| `EMBEDDING_GPU_MIN_FREE_MB` | 1536 | Free-VRAM threshold for `auto` |
| `VLLM_MODEL` | `Qwen/Qwen2.5-1.5B-Instruct-AWQ` | HF model id |
| `VLLM_SERVED_NAME` | `qwen2.5-1.5b` | Public model name |
| `VLLM_GPU_MEMORY_UTILIZATION` | 0.70 | Fraction of VRAM for KV cache + weights |
| `VLLM_MAX_MODEL_LEN` | 2048 | Hard context ceiling |
| `VLLM_MAX_NUM_SEQS` | 4 | Max concurrent sequences |
| `VLLM_ENFORCE_EAGER` | 1 | Disable CUDA graphs |
| `VLLM_PORT` | 8000 | Published vLLM port |
| `HUGGING_FACE_HUB_TOKEN` |  --  | Gated-model downloads |
| `LITELLM_MASTER_KEY` | `sk-change-me-master-key` | LiteLLM root key |
| `LITELLM_PORT` | 4000 | Gateway port |
| `API_PORT` | 4001 | Backend port |
| `JWT_SECRET` | `change-me-jwt-secret` | Dashboard JWT signing secret |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin |
| `WEB_PORT` | 5173 | Frontend dev port |

**`.env.runpod.example` deltas.** `VLLM_MODEL=stelterlab/Qwen3-30B-A3B-Instruct-2507-AWQ`, `VLLM_SERVED_NAME=qwen3-30b-a3b`, `VLLM_GPU_MEMORY_UTILIZATION=0.75`, `VLLM_MAX_MODEL_LEN=131072`, `VLLM_MAX_NUM_SEQS=8`, `EMBEDDING_PROVIDER=auto`, `CHAT_MODEL`/`RAG_CHAT_MODEL=qwen3-30b-a3b`, `MODEL_MAX_CONTEXT_TOKENS=131072`, `SUPERADMIN_EMAIL`, full `SMTP_*` block (`smtp.gmail.com:587`). `CORS_ORIGIN`, `VITE_API_BASE_URL`, `VITE_LITELLM_BASE_URL` are computed by `runpod-deploy.sh` from `RUNPOD_POD_ID` and must not be hand-set.

---

## References

* vLLM  --  PagedAttention, continuous batching, AWQ kernels. https://docs.vllm.ai/
* LiteLLM  --  LLM gateway, virtual keys, spend tracking. https://docs.litellm.ai/
* fastembed  --  ONNX embedding/reranking abstraction. https://github.com/qdrant/fastembed
* ONNX Runtime  --  execution providers, CUDA/cuDNN requirements. https://onnxruntime.ai/
* Qdrant  --  vector database, HNSW, payload filtering. https://qdrant.tech/documentation/
* SearXNG  --  metasearch engine. https://docs.searxng.org/
* Cormack et al., "Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods," SIGIR 2009. (RRF `K=60`)
* MS MARCO  --  cross-encoder reranking dataset. https://microsoft.github.io/msmarco/
* Prisma  --  schema modelling and migrations. https://www.prisma.io/docs
* Remaining backlog and accuracy plan: `remaining.md`, `rag-accuracy-improve.md` in the repository root.

---

*End of paper. All file paths and line numbers refer to the codebase at `V:\AI_API_PLATFORM\Kavach-AI` as of August 2026. Constants, ports, and model names are quoted verbatim from `docker-compose.yml`, `litellm/config.yaml`, `backend/src/utils/rag.constants.ts`, `backend/src/services/rag/retrieval.service.ts`, and `embedding/app/*.py`.*


# ai-api-platform — Phase 1: Infrastructure

A self-hosted AI API stack: a local vLLM inference engine sitting behind
LiteLLM as an OpenAI-compatible API gateway, with Postgres backing both
LiteLLM's own state (keys, spend, usage logs) and a `dashboard` database
reserved for a future management UI.

This phase is infrastructure only — no dashboard, no Prisma schema, no
auth code. Just three services you can point an OpenAI SDK at.

```
client → LiteLLM (:4000, OpenAI-compatible, key/budget/rate-limit enforcement)
              → vLLM (:8000, OpenAI-compatible, runs the actual model on GPU)
LiteLLM ↔ Postgres (:5432, "litellm" db: keys, spend, usage; "dashboard" db: reserved)
```

## Prerequisites

- **Docker** with Docker Compose v2 (`docker compose`, not `docker-compose`).
- **NVIDIA Container Toolkit**, so Docker can pass the GPU into the vLLM
  container. Verify it works before running this stack:

  ```bash
  docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi
  ```

  If that doesn't print your GPU, fix that first — vLLM will not start
  without it. See your OS's NVIDIA Container Toolkit install docs if the
  command above fails.
- An NVIDIA GPU with enough VRAM for the configured model. The default
  (`Qwen/Qwen2.5-1.5B-Instruct`, unquantized, `--max-model-len=4096`) fits
  in 8GB (e.g. RTX 5060).
- Enough disk space for the model cache — a few GB per model, persisted in
  the `huggingface_cache` volume so it isn't re-downloaded on every restart.

## Quick start

```bash
cp .env.example .env
# edit .env — at minimum set POSTGRES_PASSWORD and LITELLM_MASTER_KEY

docker compose up -d postgres vllm litellm
docker compose logs -f vllm      # first boot downloads the model; watch until "Application startup complete"
docker compose ps                # confirm all three show (healthy)
```

Generate a test API key against LiteLLM's admin endpoint:

```bash
curl -s http://localhost:4000/key/generate \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Use the returned key to call the model through LiteLLM:

```bash
curl -s http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer <key-from-above>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-1.5b",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'
```

## Ports

| Port | Service  | What it serves                                                        |
| ---- | -------- | ---------------------------------------------------------------------- |
| 4000 | LiteLLM  | OpenAI-compatible gateway (`/v1/chat/completions`, `/key/generate`, spend/usage APIs) — this is what clients and the future dashboard should talk to |
| 8000 | vLLM     | Raw OpenAI-compatible inference API — not meant for direct client use, only LiteLLM routes to it |
| 5432 | Postgres | `litellm` db (keys/spend/usage) and `dashboard` db (reserved for future use) |

## Notes

- The vLLM image tag is pinned to `v0.26.0` (released 2026-07-27), the
  first stable release confirmed to build with `TORCH_CUDA_ARCH_LIST`
  including `12.0` (sm_120, Blackwell/RTX 50-series) on a CUDA 13.0.2 base —
  well above the CUDA 12.8 floor Blackwell requires. Don't downgrade this
  tag on a 50-series GPU without re-checking `docker/versions.json` at the
  target tag.
- `store_model_in_db: true` in `litellm/config.yaml` lets a future
  dashboard add/edit models via LiteLLM's API without redeploying this
  stack.
- `default_key_generate_params` (rpm_limit 20, max_budget 5.0,
  budget_duration 30d) are placeholder ceilings applied when a
  `/key/generate` call doesn't specify its own — a dashboard should
  override them per client.

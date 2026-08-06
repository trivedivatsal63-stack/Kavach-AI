# ai-api-platform

A self-hosted AI API platform: a local vLLM inference engine sitting
behind LiteLLM as an OpenAI-compatible gateway (key issuance, budgets,
spend/usage tracking), with a small Express API and a React dashboard on
top for account signup, API key management, credit balance, and usage
analytics.

```
Browser → frontend (:5173, React/Vite dashboard)
              → backend (:4001, Express: auth, keys, credits, usage)
                    → LiteLLM (:4000, admin API: /key/generate, /key/info, /spend/logs/v2, ...)
client apps  → LiteLLM (:4000, OpenAI-compatible: /v1/chat/completions)
                    → vLLM (:8000, OpenAI-compatible, runs the actual model on GPU)

Postgres (:5432) — "litellm" db (LiteLLM's own keys/spend/usage state)
                  — "dashboard" db (backend/'s User + ApiKey tables)
```

`frontend` never talks to LiteLLM directly for account/key data, and `backend`
never maintains its own usage ledger — LiteLLM stays the single source of
truth for spend, budgets, and usage; `backend` only reads it and drives real
LiteLLM key budgets from each user's credit balance.

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
# edit .env — at minimum set POSTGRES_PASSWORD, LITELLM_MASTER_KEY,
# JWT_SECRET

docker compose up -d
docker compose logs -f vllm      # first boot downloads the model; watch until "Application startup complete"
docker compose ps                # confirm all five show (healthy)
```

Then open `http://localhost:5173` and sign up — that creates an account
with a $5.00 mock credit balance, from which you can generate a real
LiteLLM API key and use it against `http://localhost:4000/v1/chat/completions`.

To drive LiteLLM directly instead (e.g. for scripting):

```bash
curl -s http://localhost:4000/key/generate \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'

curl -s http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer <key-from-above>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-1.5b",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'
```

## Ports

| Port | Service    | What it serves                                                                                    |
| ---- | ---------- | -------------------------------------------------------------------------------------------------- |
| 5173 | frontend  | React dashboard — signup/login, API key management, credit balance/top-up, usage                  |
| 4001 | backend   | Express API backing `frontend` — `/auth`, `/keys`, `/credits`, `/usage` (JWT-protected)               |
| 4000 | LiteLLM    | OpenAI-compatible gateway (`/v1/chat/completions`) and admin API (`/key/generate`, `/spend/logs/v2`, ...) |
| 8000 | vLLM       | Raw OpenAI-compatible inference API — not meant for direct client use, only LiteLLM routes to it   |
| 5432 | Postgres   | `litellm` db (LiteLLM's own state) and `dashboard` db (`backend/`'s User + ApiKey tables)             |

## Notes

- The vLLM image tag is pinned to `v0.26.0` (released 2026-07-27), the
  first stable release confirmed to build with `TORCH_CUDA_ARCH_LIST`
  including `12.0` (sm_120, Blackwell/RTX 50-series) on a CUDA 13.0.2 base —
  well above the CUDA 12.8 floor Blackwell requires. Don't downgrade this
  tag on a 50-series GPU without re-checking `docker/versions.json` at the
  target tag.
- `store_model_in_db: true` in `litellm/config.yaml` lets models be
  added/edited via LiteLLM's API without redeploying this stack.
- `litellm/config.yaml`'s per-token `input_cost_per_token`/
  `output_cost_per_token` are placeholder rates, not real economics — the
  model has no entry in LiteLLM's built-in cost map (it's self-hosted), so
  without them every request would compute $0.00 spend and budget
  enforcement could never fire.
- `backend/` generates each key's real LiteLLM `max_budget` from the user's
  current `creditBalanceUsd` at generation time, and updates it again on
  every mock credit top-up — the credit balance is enforced by LiteLLM
  itself, not just displayed.
- `frontend/`'s JWT is kept in memory only (React state, no localStorage) —
  safer against XSS than localStorage, at the cost of losing the session
  on a hard page reload. An httpOnly cookie would be the further
  improvement, but requires `backend/` to set it.
- The original Next.js dashboard (Phase 1–4) was replaced by `backend/` +
  `frontend/`; see git history for the removed monolith if needed.

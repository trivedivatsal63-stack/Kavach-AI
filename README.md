# Kavach-AI

Self-hosted AI API platform: **vLLM** (inference) + **LiteLLM** (keys/budgets/spend) + Express API + React dashboard.

## Hybrid run mode

| Service | Where it runs |
|---------|----------------|
| **vLLM** + **LiteLLM** | Docker (`docker compose up -d`) |
| Postgres, Qdrant, embedding, backend, frontend | Local terminals |

```
Browser → frontend :5173 → backend :4001 → LiteLLM :4000 (Docker) → vLLM :8000 (Docker)
Host Postgres :5432  ← LiteLLM (via host.docker.internal) + backend
```

Full steps: [`scripts/LOCAL_RUN.md`](scripts/LOCAL_RUN.md)

RunPod whole-stack (native processes, no Docker): [`scripts/RUNPOD_DEPLOY.md`](scripts/RUNPOD_DEPLOY.md)

## Quick start

```powershell
# 1) Env
copy .env.example .env
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
# set POSTGRES_PASSWORD / JWT_SECRET / LITELLM_MASTER_KEY

# 2) Host DBs (once): litellm + dashboard — then:
cd backend
npm install
npx prisma db push

# 3) Docker inference only
cd ..
docker compose up -d

# 4) Local API + UI
cd backend; npm run dev
# other terminal:
cd frontend; npm run dev
```

## How you reach vLLM

Apps call **LiteLLM** on `:4000`. LiteLLM (in Docker) forwards to **vLLM** at `http://vllm:8000/v1` on the compose network. Do not point clients at `:8000` directly.

## Backend layout (MVC + services)

```
backend/src/
  routes/  controllers/  services/  models/  middleware/  config/
```

## Ports

| Port | Service |
|------|---------|
| 5173 | frontend (host) |
| 4001 | backend (host) |
| 4000 | LiteLLM (Docker) |
| 8000 | vLLM (Docker) |
| 8002 | embedding (host, RAG) |
| 6333 | Qdrant (host, RAG) |
| 5432 | Postgres (host) |

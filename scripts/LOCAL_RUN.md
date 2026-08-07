# Hybrid runbook — host terminals + Docker (vLLM + LiteLLM only)

## Architecture

```
Host terminals                          Docker
─────────────────                       ────────────────────────
Postgres :5432  (litellm + dashboard) ←─ LiteLLM uses host.docker.internal
Qdrant :6333
Embedding :8002
Backend :4001  ──────────────────────→ LiteLLM :4000 (published)
Frontend :5173                              │
                                            └→ vLLM :8000 (compose network)
```

## One-time: allow Docker → host Postgres

LiteLLM (in Docker) must reach your Windows Postgres. In `postgresql.conf`:

```
listen_addresses = '*'
```

In `pg_hba.conf` add (local-dev only):

```
host    all    all    0.0.0.0/0    scram-sha-256
```

Then restart the `postgresql-x64-18` Windows service.

Confirm DBs exist: `litellm`, `dashboard`.

## Start order

### 1) Postgres (Windows service)
Already running if you used pgAdmin successfully.

### 2) Docker inference (vLLM + LiteLLM)
From repo root:

```powershell
docker compose up -d
docker compose logs -f vllm
```

Wait for vLLM: `Application startup complete`, then LiteLLM healthy.
Check: `http://localhost:4000/health/readiness` and `http://localhost:8000/health`

### 3) Qdrant (optional until RAG)
```powershell
qdrant.exe
```

### 4) Embedding (optional until RAG)
```powershell
cd embedding
.\.venv\Scripts\Activate.ps1
$env:EMBEDDING_PROVIDER="cpu"
uvicorn app.main:app --host 0.0.0.0 --port 8002
```

### 5) Backend
```powershell
cd backend
npm run dev
```

You should see: `[db] Connected to Postgres ...` and `LiteLLM gateway expected at http://127.0.0.1:4000`

### 6) Frontend
```powershell
cd frontend
npm run dev
```

Open http://localhost:5173

## Troubleshooting

| Symptom | Cause |
|---------|--------|
| `[db] Postgres connection FAILED` | Wrong `DATABASE_URL` / Postgres down / no `dashboard` DB |
| `Cannot reach LiteLLM` on /keys | `docker compose up -d` not running or still starting |
| LiteLLM unhealthy / DB errors in compose logs | Postgres not reachable from Docker — fix listen_addresses / pg_hba |
| vLLM OOM | Lower `VLLM_GPU_MEMORY_UTILIZATION` to 0.60 in `.env` |

## Path to vLLM

Client → `http://localhost:4000/v1/chat/completions` (LiteLLM) → Docker network `http://vllm:8000/v1` (vLLM).

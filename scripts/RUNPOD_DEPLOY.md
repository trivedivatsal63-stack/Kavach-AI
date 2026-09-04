# RunPod whole-stack deploy — native processes (no Docker)

Standalone production path for an RTX A6000 (48GB) pod running **every**
service as a native OS process under `supervisord`. This does **not** replace
the laptop hybrid setup in [`LOCAL_RUN.md`](LOCAL_RUN.md) — leave
`docker-compose.yml` and local LiteLLM model entries alone.

No custom domain in this pass. Public access is via RunPod’s free proxy URLs
(`https://<pod-id>-<port>.proxy.runpod.net`). Cloudflare Tunnel /
`harrierkavachai.com` is a separate follow-up.

## Architecture

```
RunPod pod (single Linux container / OS, Volume disk at /workspace)
──────────────────────────────────────────────────────────────────
supervisord
  ├── postgres   :5432   (internal)
  ├── vllm       :8000   (internal)  Qwen3-30B-A3B, 128K via YaRN
  ├── litellm    :4000   ← exposed
  ├── embedding  :8002   (internal)
  ├── qdrant     :6333   (internal)
  ├── searxng    :8888   (internal)
  ├── backend    :4001   ← exposed
  └── frontend   :5173   ← exposed
```

Why not Docker Compose inside the pod? RunPod’s standard pod UI does not
offer privileged mode, so Docker-in-Docker is not viable. A pod already *is*
one container — run services as processes instead.

## Pod creation settings

| Setting | Value |
|---------|--------|
| GPU | RTX A6000 (48GB) |
| Template | CUDA / PyTorch with **SSH** (general root access — not a single-purpose vLLM template) |
| CUDA filter | Pin to **12.4 / 12.7 / 12.8** (avoid hosts that would assign incompatible 13.0; `cuda12.4.1` templates are a known-good choice) |
| Storage | **Volume disk** ≥ **100GB** mounted at `/workspace` |
| Expose HTTP Ports | `5173,4001,4000` only |

**Storage type note:** Network Volume was unavailable for A6000 in any
datacenter at deploy time, so this path uses **Volume disk**. It still mounts
at `/workspace` and survives normal stop/restart of the *same* pod, but it is
**permanently deleted if the pod itself is terminated**. Prefer migrating to a
Network Volume later if A6000 + network-volume capacity appears in a region.

## One-time setup on the pod

### 1) Clone into `/workspace` (persist across stop/restart)

```bash
cd /workspace
git clone <your-repo-url> kavach-ai
cd kavach-ai
```

`supervisord.conf` and the scripts assume the repo lives at
`/workspace/kavach-ai`. Do not clone elsewhere.

### 2) ⚠️ Back up before every Stop — Postgres is NOT on the volume

`/workspace` on this template is a FUSE network mount **without `chown`
support** (verified live), and Postgres refuses to run on a data directory
it doesn't own. So the live cluster runs on container disk
(`/var/lib/postgresql/pgdata`), which is **wiped on every pod stop** —
only `/workspace` survives. Qdrant (`/workspace/qdrant/storage`), the HF
cache, venvs, repo and `.env` are already volume-native and need nothing.

The safety net is dumps, not the live files:

```bash
./scripts/backup-runpod.sh   # pg_dumpall → /workspace/backups/latest.sql (+ rotation)
```

Run it **before every Stop**. `runpod-setup.sh` auto-restores
`latest.sql` onto a fresh container disk, and `runpod-deploy.sh` refreshes
the dump after every successful deploy — but a crash between deploy and
Stop would lose data without a manual backup. Also copy `.env` off-pod
once (secrets are not in git).

Volume disk itself is destroyed only if the pod is **terminated/deleted**
(as opposed to stopped) — with current dumps on the volume plus an off-pod
`.env` copy, even that is recoverable onto a new pod.

### 3) Provision (once — idempotent, safe to re-run)

```bash
chmod +x scripts/runpod-setup.sh scripts/runpod-deploy.sh scripts/runpod-start-vllm.sh
./scripts/runpod-setup.sh
```

Installs system packages, Postgres cluster on container disk (auto-restoring
`/workspace/backups/latest.sql` when present — see section 2),
vLLM / LiteLLM / embedding / SearXNG venvs, Qdrant binary, backend build,
frontend `npm ci` (frontend *build* is deferred to deploy so proxy URLs can
be baked in).

### 4) Deploy

```bash
./scripts/runpod-deploy.sh
```

First run copies `.env.runpod.example` → `.env` and exits asking you to fill
secrets, then re-run:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `LITELLM_MASTER_KEY`
- `SMTP_USER` / `SMTP_PASS` (and `SMTP_FROM`) for email OTPs
- optional `HUGGING_FACE_HUB_TOKEN`

Deploy then:

1. Reads `RUNPOD_POD_ID` (injected by RunPod)
2. Writes `CORS_ORIGIN`, `VITE_API_BASE_URL`, `VITE_LITELLM_BASE_URL`
3. Builds the frontend with those URLs
4. Starts / reloads supervisord
5. Polls health endpoints (vLLM’s first download of ~19GB can take several minutes)

## Public URLs

After a successful deploy you get three proxy URLs:

| URL | Purpose |
|-----|---------|
| `https://<pod-id>-5173.proxy.runpod.net` | Frontend UI |
| `https://<pod-id>-4001.proxy.runpod.net` | Backend API |
| `https://<pod-id>-4000.proxy.runpod.net` | LiteLLM (product’s public OpenAI-compatible gateway) |

Clients call **LiteLLM** on `:4000`, not vLLM on `:8000` directly.

## Database access (Postgres is internal-only)

`postgres` is **not** on RunPod’s exposed ports (and neither are vLLM,
embedding, Qdrant, or SearXNG). Reach the DB only from inside the pod or via
an SSH tunnel.

**Do not** add `5432` to “Expose TCP Ports” — that would put a real database
on the open internet with only a password protecting it.

### SSH tunnel (pgAdmin / DBeaver / TablePlus)

From your laptop (IP and SSH port from the pod’s **Connect** screen):

```bash
ssh -L 5432:localhost:5432 root@<pod-ip> -p <pod-ssh-port>
```

Then point the GUI at `localhost:5432` (user `postgres`, password from `.env`,
database `dashboard` or `litellm`).

### Direct `psql` on the pod

```bash
sudo -u postgres /workspace/bin/pg_bin/psql -d dashboard
# or:
sudo -u postgres psql -h 127.0.0.1 -d dashboard
```

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| vLLM OOM / CUDA OOM | Lower `VLLM_GPU_MEMORY_UTILIZATION` (e.g. `0.65`) in `.env`, re-run deploy |
| Embedding / reranker starved for VRAM | Check `EMBEDDING_GPU_MIN_FREE_MB` headroom vs vLLM’s reservation (`0.75 × 48GB`); raise headroom or lower vLLM util |
| HTTP **524** on long chat / large uploads | RunPod’s proxy has a **~100-second request cap**. Known limitation in this pass — not yet mitigated (streaming verification is follow-up work) |
| Service not starting | `supervisorctl -c scripts/supervisord.conf status` then `supervisorctl -c scripts/supervisord.conf tail <service>` |
| `RUNPOD_POD_ID not found` | Script was run off-pod; must run on the actual RunPod instance |
| Repo path warnings | Clone must be `/workspace/kavach-ai` to match `supervisord.conf` |
| LiteLLM DB / auth errors | Confirm `litellm` DB exists and `POSTGRES_PASSWORD` matches what setup wrote |
| Frontend talks to wrong host | Re-run `./scripts/runpod-deploy.sh` so Vite rebuilds with current proxy URLs |

Useful commands:

```bash
supervisorctl -c scripts/supervisord.conf status
supervisorctl -c scripts/supervisord.conf tail -f vllm
supervisorctl -c scripts/supervisord.conf restart backend
tail -f logs/*.log
```

## Out of scope (follow-ups)

- Custom domain / Cloudflare Tunnel
- Mitigating the 100s RunPod proxy timeout (e.g. streaming verification)
- Corporate CA injection for SearXNG (laptop-only workaround; not needed on RunPod)

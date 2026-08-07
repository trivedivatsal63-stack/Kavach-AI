#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host @"

Kavach-AI — hybrid run
======================
Docker (only):  vLLM :8000 + LiteLLM :4000
Host terminals: Postgres, Qdrant, embedding, backend, frontend

1) Postgres Windows service + DBs litellm, dashboard
2) docker compose up -d   (from repo root; wait for vLLM healthy)
3) Qdrant (optional for RAG)
4) Embedding uvicorn :8002 (optional for RAG)
5) cd backend; npm run dev
6) cd frontend; npm run dev

Path to model: Client → LiteLLM :4000 → vLLM :8000

Repo: $root
Docs: scripts\LOCAL_RUN.md
"@

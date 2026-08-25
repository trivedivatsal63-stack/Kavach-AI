# Improvements — 2026-08-24

Tracked after complex query evaluation on `deployment-state` (Qwen2.5-7B, RAG 8192, live SearXNG).

## What needs fixing (priority order)

### 1. Faithfulness check — blocks hallucination
- **File:** `backend/src/services/chat.service.ts:62`, `backend/src/services/rag/chat.service.ts:48`, `remaining.md:57`
- **Issue:** Qwen `60-80GB vRAM` and ISRO `PSLV-C58 EOS-02 RISAT-02F April 2024` fabricated despite not in excerpts (`WEB_SEARCH_ADDENDUM: use ONLY facts in excerpts`). Small model `qwen2.5-7b` ignores `SYSTEM_PROMPT:16` `never invent`.
- **Fix:** Post-hoc answer ⊂ excerpts check (reuse `reranker.service.ts:22` pattern), reject/flag if claim not verbatim.

### 2. Source quality / rerank
- **File:** `backend/src/services/liveSearch/liveSearch.service.ts:47`, `backend/src/services/liveSearch/fetchPage.service.ts:54`
- **Issue:** `runpod.io/pricing` not fetched (blog chosen over pricing), `isro.gov.in` missing for ISRO query, Nobel correct with 3 pills.
- **Fix:** Add preferred domain weighting (`huggingface.co`, `isro.gov.in`, `runpod.io`) and demote blogs when `.gov`/official present. Improve Readability passage selection.

### 3. Token budget starvation
- **File:** `backend/src/utils/liveSearch.constants.ts:38`, `backend/src/services/rag/chat.service.ts:127`, `backend/src/services/rag/retrieval.service.ts:195`
- **Issue:** IBC doc cite missing — `LIVE_SEARCH_TOKEN_BUDGET_WITH_RAG=400` + `PAGE_FETCH_MAX_CHARS=1200` lets 1 page fill budget, RAG `chunkTokenBudget` starved. Pune only 1/1 source.
- **Fix:** Raise budget to 600 or store 400-char passage-selected excerpts so 3 sources coexist within 400 tokens.

### 4. Citation discipline
- **File:** `backend/src/controllers/completions.controller.ts:94`, `backend/src/services/liveSearch/webCitationFormat.ts:8`, `frontend/src/components/chat/WebCitations.tsx:6`, `frontend/src/components/chat/MessageThread.tsx:7`
- **Issue:** Qwen cited `[1]` for 3 facts, IBC no `[document]` vs `[web]` split (`docContext` + `webContext` numbered together at `chat.service.ts:152`). Pills showed 1 instead of 3.
- **Fix:** Enforce `cite per sentence [n]` + return `citations` + `webCitations` separately; pills already links-only with favicon, ensure inline `[n]` pills render for each fact.

### 5. RAG retrieval
- **File:** `backend/src/services/rag/retrieval.service.ts:195`, `remaining.md:54`
- **Issue:** IBC Section 4 threshold exists in docs but RAG returned 0 citations — likely `CANDIDATE_POOL_SIZE=24` / `MIN_RETRIEVAL_SCORE` filtering.
- **Fix:** Re-test with `dashboard` DB doc chunks, verify `MAX_CHUNK_CHARS` ingestion and hybrid RRF ranking.

## Verified recent changes (2026-08-24)
- `fetchPage.service.ts:1` lazy jsdom/Readability + fallback to `node-html-parser` (pod Node 20.20.2 crash-loop fix), pinned `jsdom 24.1.3`
- `liveSearch.service.ts:42` dedup by normalized URL + cross-encoder rerank via `reranker.service.ts`
- `liveSearch.constants.ts:8` `LIVE_SEARCH_CANDIDATE_POOL 6→8`
- `WebCitations.tsx:6` Claude/ChatGPT pills (favicon + domain, links-only, no excerpt), `MessageThread.tsx:7` inline `[n]` pills
- `mail.service.ts:36` Avast TLS `SMTP_TLS_INSECURE` gated by `NODE_ENV !== production`
- `litellm/config.yaml:7` both `qwen2.5-7b`/`qwen2.5-1.5b` → `openai/qwen2.5-7b` for `VLLM_SERVED_NAME=qwen2.5-7b`

## Next steps
1. Implement faithfulness check (~1h) — highest ROI.
2. Domain-weighted rerank (~1h).
3. Budget tweak 400→600 (30 min) + verify with 6 complex queries (IBC, Qwen, ISRO, Pune, Nodemailer, Apple).

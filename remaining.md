# Remaining work

Consolidated backlog from the security and RAG-quality review on 2026-08-14. Nothing here is started. Estimates are rough engineering time, not calendar time, and are flagged where scope is genuinely uncertain rather than just rounded for tidiness.

## Security

### 1. SSRF guard on live search page fetching
`fetchPageText()` (`backend/src/services/liveSearch/fetchPage.service.ts`) fetches whatever URL SearXNG returns with no check on where it resolves. A malicious/compromised search result pointing at an internal address (e.g. `127.0.0.1:6333`, or a cloud metadata endpoint like `169.254.169.254` if ever deployed on AWS/GCP) would get fetched and its content fed straight into the LLM prompt. Low likelihood in practice (results come from real search engines), but genuinely unguarded.
- **Fix:** resolve the hostname, reject private/loopback/link-local IP ranges before fetching; must also re-check on every redirect hop, since `redirect: "follow"` currently bypasses a check done only on the initial URL.
- **Estimate:** 30–45 min.

### 2. Prompt injection framing for web content
Fetched web content flows into the prompt with no delimiter beyond normal instruction text, across three injection points (`rag/chat.service.ts`, `chat.service.ts`, `completions.controller.ts`). This model's small size makes it more susceptible to "ignore previous instructions"-style content embedded in a page than a larger model would be.
- **Fix:** wrap injected web content in clear "untrusted data, not instructions" framing at all three call sites.
- **Estimate:** 20–30 min.

### 3. Zip-bomb / decompression cap on DOCX/XLSX uploads + `npm audit` pass
DOCX/XLSX are ZIP-based; only the compressed upload size (25MB) is capped today, not decompressed size — a crafted archive could decompress to a much larger size and cause a DoS. Parsers (mammoth, pdf-parse, exceljs) also run directly against attacker-controlled files, worth a baseline vulnerability check.
- **Fix:** cap decompressed size before/while parsing (need to check whether mammoth/exceljs expose this directly, or a ZIP central-directory pre-scan is needed); run and review `npm audit`.
- **Estimate:** 45–90 min — the audit is ~10 min, the decompression cap has real scope uncertainty depending on what the libraries expose.

### 4. Rate limiting
Nothing currently limits request rate anywhere — unlimited password-guessing on `/auth/login`, scripted mass signups to repeatedly farm the $5 free credit balance, or one API key hammering live search (real GPU + SearXNG cost per call).
- **Fix:** per-IP and/or per-key rate limiting on auth and API routes.
- **Estimate:** not yet scoped in detail — likely 1–1.5 hrs depending on whether it's a simple in-memory limiter or needs to survive backend restarts.

### 5. JWT session revocation
Sessions are stateless JWTs, 7-hour expiry (`middleware/auth.ts`), no server-side revocation. A leaked token stays valid for up to 7 hours with no way to kill it early.
- **Fix (minimal):** a denylist table checked in auth middleware. **Fix (bigger):** shorter-lived access tokens + refresh token rotation.
- **Estimate:** not yet scoped in detail — minimal version likely 1–1.5 hrs.

## RAG quality

### 6. Reranking
Retrieval today stops at RRF-fused first-stage candidates (vector + keyword). No cross-encoder reranking step scores (query, chunk) pairs jointly before generation — this is the single biggest gap versus how production RAG systems retrieve, and the most likely fix for cases like the earlier LLP Act queries that retrieved plausible-but-wrong chunks.
- **Fix:** add a small self-hosted cross-encoder (e.g. `bge-reranker-base`, CPU-feasible) reranking the top of the fused candidate pool before the token-budget cutoff.
- **Estimate:** 2–4 hrs, depending on whether it extends the existing embedding microservice or needs its own.

### 7. Query rewriting for conversational follow-ups
Retrieval only ever embeds the latest message — a follow-up like "what about the renewal terms?" has no idea what "renewal terms" refers to without prior turns folded in. Currently invisible because testing so far has mostly been single-shot questions.
- **Fix:** rewrite the query into a self-contained form using recent history before embedding it, in `rag/chat.service.ts`.
- **Estimate:** 1–1.5 hrs — real design decision needed on the added latency/cost of an extra completion call before retrieval.

### 8. Retrieval evaluation harness
All retrieval-quality verification so far has been manual, ad hoc testing against a handful of real queries per change — rigorous in the moment, not repeatable. No way to know today if an earlier fix has silently regressed.
- **Fix:** a small labeled test set (question → expected chunk/answer) plus a script computing recall@k / MRR, run on retrieval-affecting changes.
- **Estimate:** harness code ~1–2 hrs; building a genuinely useful labeled set is separate effort, hard to size cleanly.

### 9. Contextual chunking
Chunks are structure-aware (heading-path tracked) but embedded in isolation — a chunk saying "the deadline is 30 days" loses that it's about refunds specifically once separated from its heading.
- **Fix:** prepend a short LLM-generated context blurb to each chunk before embedding (Anthropic's "contextual retrieval" technique) — the existing `headingPath` tracking is already half the infrastructure needed.
- **Estimate:** 1.5–2.5 hrs — adds an LLM call per chunk at ingestion time, so also a cost/latency tradeoff on upload.

### 10. Faithfulness checking
The system prompt strongly instructs the model not to answer beyond the retrieved context, but nothing verifies it actually didn't — small models ignore such instructions more often than large ones.
- **Fix:** a post-hoc check comparing the generated answer's claims against the cited chunks.
- **Estimate:** 1–1.5 hrs.

### 11. Document versioning
Re-uploading a changed document today just creates a new document row — no "this replaces the old version" concept, so stale chunks from an outdated file keep surfacing alongside the new ones.
- **Fix (minimal):** same filename on re-upload soft-deletes the old document + its chunks/vectors, then ingests fresh. Touches the upload flow, retrieval path, and the frontend document list.
- **Estimate:** 1.5–2.5 hrs.

### 12. OCR fallback for scanned PDFs
A scanned/image-only PDF silently extracts little or no text via `pdf-parse`, and nothing tells the user their document didn't actually index meaningfully. The largest, least certain item here — usually needs a native dependency (e.g. poppler) for PDF-to-image conversion, on top of the OCR step itself, and is the most likely of everything on this list to hit unexpected environment friction (same flavor as the cloudflared/ngrok networking issues from this session).
- **Fix:** detect low-text-relative-to-page-count, rasterize pages, run OCR (e.g. Tesseract.js), merge back into the chunking pipeline.
- **Estimate:** 3–5+ hrs, least certain of the list.

---

**Total if all twelve were done: roughly 13–20+ hours**, weighted heavily toward items 6, 8, 11, and 12 — everything else is fairly tightly bounded.

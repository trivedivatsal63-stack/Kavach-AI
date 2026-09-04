// Central constants for the live-search module (services/liveSearch/) —
// mirrors how rag.constants.ts centralizes RAG's tuning knobs.

// How many SearXNG results to consider per query before token-budget
// filtering / reranking decides how many actually make it into the prompt.
// Bumped 6 -> 8 so reranking has choice without excessive fetch.
export const LIVE_SEARCH_CANDIDATE_POOL = 8;

export const PAGE_FETCH_TIMEOUT_MS = 6000;
// Hard cap on bytes read off the response stream — stops reading (not just
// truncates after the fact) once exceeded, so one huge page can't stall a
// request that's fetching several pages in parallel.
export const PAGE_FETCH_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
// Extracted *text* is capped separately and much smaller — this is a rough
// pre-trim before the real token-budget cutoff in liveSearch.service.ts
// decides what actually fits, not the final size. Kept close to RAG's own
// chunk excerpt cap (truncate(chunk.content, 500) in retrieval.service.ts)
// deliberately: verified that leaving this at a much larger 6000 meant the
// FIRST fetched page alone consumed the entire ~400-700 token live-search
// budget every time (a 6000-char page is ~1500 tokens), silently reducing
// "search results" to "one source" on every real query. This size leaves
// room for 2-3 sources to actually coexist within budget.
export const PAGE_FETCH_MAX_CHARS = 1200;

export const USER_AGENT =
  "Mozilla/5.0 (compatible; HarrierKavachAI-LiveSearch/1.0; +self-hosted)";

// Live search shares the model's 2048-token window with everything else
// (see MODEL_MAX_CONTEXT_TOKENS in rag.constants.ts) — the same discipline
// that already burned this project once (raising the RAG retrieval limit to
// 12 chunks blew the window). Two budgets, same split rationale as
// RAG_HISTORY_TOKEN_BUDGET vs CHAT_HISTORY_TOKEN_BUDGET in chat.constants.ts:
//  - Alongside RAG document context: web results must not starve out the
//    document chunks that are the primary value there, so a small budget.
//  - Alone (general chat / the public completions proxy, no document
//    context competing): a larger budget, since nothing else needs the room.
export const LIVE_SEARCH_TOKEN_BUDGET_WITH_RAG = 400;
export const LIVE_SEARCH_TOKEN_BUDGET_STANDALONE = 700;

// Preferred outlets per purpose domain (see searchDecision.service.ts).
// Applied as a rerank-order bonus in liveSearch.service.ts — never a filter,
// so an authoritative hit can outrank junk but junk is never dropped (the
// best-effort fallback contract stays intact). Hostnames match by suffix, so
// subdomains (e.g. finance.yahoo.com) count.
export const DOMAIN_PREFERRED_OUTLETS: Record<string, string[]> = {
  finance: [
    "reuters.com",
    "bloomberg.com",
    "cnbc.com",
    "finance.yahoo.com",
    "marketwatch.com",
    "ft.com",
    "wsj.com",
    "sec.gov",
    "fool.com",
  ],
  people: ["linkedin.com", "theorg.com", "crunchbase.com", "signalhire.com"],
  // tech/general have no universal outlet list (official docs vary per
  // product) — the cross-encoder rerank already handles those well.
  tech: [],
  general: [],
};

// Office-document downloads almost never answer people/company questions
// directly (verified: a departmental-approval .xlsx outranked real profiles
// for a "who is" query). Demoted one tier when non-file candidates exist —
// never dropped, since a filings PDF can be the right answer for finance.
export const OFFICE_FILE_EXTENSIONS = [".xls", ".xlsx", ".doc", ".docx", ".ppt", ".pptx", ".csv"];

import { searchWeb } from "./search.service";
import { fetchPageText } from "./fetchPage.service";
import { formatWebCitation } from "./webCitationFormat";
import { countTokens } from "../rag/tokenizer.service";
import { LIVE_SEARCH_CANDIDATE_POOL } from "../../utils/liveSearch.constants";
import type { WebCitation } from "./types";

// Orchestrates one live-search round: search -> fetch each result's real
// page text in parallel -> keep as many as fit a token budget. Only
// selection lives here — formatting the selected citations into prompt text
// is webCitationFormat.ts's job, kept separate so callers can measure a
// tentative token cost before they know the citations' final numbering
// (e.g. RAG merges these after its own document citations).
export async function getLiveSearchContext(input: {
  query: string;
  budgetTokens: number;
}): Promise<WebCitation[]> {
  let results;
  try {
    results = await searchWeb(input.query, LIVE_SEARCH_CANDIDATE_POOL);
  } catch (err) {
    console.error("Live search (SearXNG) failed:", err);
    return [];
  }
  if (results.length === 0) return [];

  // A slow or failed fetch for one result must not hold up or drop the
  // others — each is independent, so allSettled, not all.
  const fetched = await Promise.allSettled(results.map((r) => fetchPageText(r.url)));

  const candidates: WebCitation[] = results
    .map((r, i) => {
      const settled = fetched[i];
      const pageText = settled.status === "fulfilled" ? settled.value : null;
      return { title: r.title, url: r.url, excerpt: pageText ?? r.snippet };
    })
    .filter((c) => c.excerpt.trim().length > 0);

  // Token-budget walk — same discipline as retrieval.service.ts's retrieve()
  // (the earlier "raised the RAG limit to 12, blew the 2048-token window"
  // incident is exactly why this matters here too): walk best-first
  // (SearXNG's own relevance ranking), stop at the first candidate that
  // would exceed budget rather than skipping ahead to grab a smaller one
  // out of rank order. Always keep at least one result even if it alone is
  // over budget — a best-effort single source beats zero live context.
  const citations: WebCitation[] = [];
  let used = 0;
  for (const candidate of candidates) {
    const tokens = await countTokens(formatWebCitation(citations.length, candidate));
    if (citations.length > 0 && used + tokens > input.budgetTokens) break;
    citations.push(candidate);
    used += tokens;
  }

  return citations;
}

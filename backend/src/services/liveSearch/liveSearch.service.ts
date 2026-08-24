import { searchWeb } from "./search.service";
import { fetchPageText } from "./fetchPage.service";
import { formatWebCitation } from "./webCitationFormat";
import { countTokens } from "../rag/tokenizer.service";
import { LIVE_SEARCH_CANDIDATE_POOL } from "../../utils/liveSearch.constants";
import type { WebCitation } from "./types";
import { rerankChunks } from "../rag/reranker.service";

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

  let candidates: WebCitation[] = results
    .map((r, i) => {
      const settled = fetched[i];
      const pageText = settled.status === "fulfilled" ? settled.value : null;
      return { title: r.title, url: r.url, excerpt: pageText ?? r.snippet };
    })
    .filter((c) => c.excerpt.trim().length > 0);

  // Dedup by normalized URL — avoids 2-3 sources collapsing to same page via
  // tracking params or http vs https.
  candidates = dedupByUrl(candidates);

  // Optional cross-encoder rerank — generic accuracy improvement (no domain
  // routing). Reuses RAG's reranker; best-effort fallback to SearXNG order
  // if the embedding service is unreachable.
  const reranked = await rerankWebCandidates(input.query, candidates);
  const ordered = reranked ?? candidates;

  // Token-budget walk — same discipline as retrieval.service.ts's retrieve()
  // (the earlier "raised the RAG limit to 12, blew the 2048-token window"
  // incident is exactly why this matters here too): walk best-first
  // (now reranked when available), stop at the first candidate that
  // would exceed budget rather than skipping ahead to grab a smaller one
  // out of rank order. Always keep at least one result even if it alone is
  // over budget — a best-effort single source beats zero live context.
  const citations: WebCitation[] = [];
  let used = 0;
  for (const candidate of ordered) {
    const tokens = await countTokens(formatWebCitation(citations.length, candidate));
    if (citations.length > 0 && used + tokens > input.budgetTokens) break;
    citations.push(candidate);
    used += tokens;
  }

  return citations;
}

function dedupByUrl(candidates: WebCitation[]): WebCitation[] {
  const seen = new Set<string>();
  const out: WebCitation[] = [];
  for (const c of candidates) {
    const norm = normalizeUrl(c.url);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(c);
  }
  return out;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    // strip common tracking params
    const strip = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
    for (const p of strip) u.searchParams.delete(p);
    // normalize: lowercase host, remove trailing slash
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

async function rerankWebCandidates(
  query: string,
  candidates: WebCitation[]
): Promise<WebCitation[] | null> {
  if (candidates.length <= 1) return null;
  try {
    const rerankInput = candidates.map((c, i) => ({
      chunkId: String(i),
      content: `${c.title}\n${c.excerpt}`,
    }));
    const scores = await rerankChunks(query, rerankInput);
    if (!scores) return null;
    return [...candidates].sort((a, b) => {
      const ai = candidates.indexOf(a);
      const bi = candidates.indexOf(b);
      return (scores.get(String(bi)) ?? 0) - (scores.get(String(ai)) ?? 0);
    });
  } catch {
    return null;
  }
}

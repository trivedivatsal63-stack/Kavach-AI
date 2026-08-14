import type { WebCitation } from "./types";

// Mirrors rag/citationFormat.ts's formatCitation/formatContext split exactly
// — same reason: this exact formatting is used both to measure real token
// cost (liveSearch.service.ts's budget walk) and to build the actual prompt
// text (every call site that injects web context), and those two must never
// drift apart or the token-budget cutoff stops measuring what's really sent.
export function formatWebCitation(index: number, citation: WebCitation): string {
  return `[${index + 1}] (web) ${citation.title} — ${citation.url}\n${citation.excerpt}`;
}

export function formatWebContext(citations: WebCitation[], startIndex = 0): string {
  return citations.map((c, i) => formatWebCitation(startIndex + i, c)).join("\n\n");
}

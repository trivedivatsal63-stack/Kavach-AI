import type { Citation } from "../../models/rag/types";

// Shared by chat.service.ts (assembling the real prompt sent to the model)
// and retrieval.service.ts (measuring token cost while deciding which
// chunks to include). Both MUST use the exact same formatting — if they
// drifted apart, the token-budget cutoff would be measuring something other
// than what actually gets sent, defeating its whole purpose.
export function formatCitation(index: number, citation: Citation): string {
  const location = [
    citation.source,
    ...(citation.headingPath && citation.headingPath.length > 0 ? citation.headingPath : []),
  ].join(" > ");
  const match = Math.round(citation.score * 100);
  return `[${index + 1}] ${location} — match ${match}%\n${citation.excerpt}`;
}

export function formatContext(citations: Citation[]): string {
  return citations.map((c, i) => formatCitation(i, c)).join("\n\n");
}

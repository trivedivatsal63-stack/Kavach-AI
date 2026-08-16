// Web sources are ephemeral (never persisted beyond the Message.webCitations
// JSON column) — unlike models/rag/types.ts's Citation, there's no DB row
// shape backing this, just the shape returned to callers and stored as-is.
export interface WebCitation {
  url: string;
  title: string;
  excerpt: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

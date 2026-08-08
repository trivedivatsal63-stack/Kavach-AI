// Shared types between parsers.ts (extraction) and chunker.ts /
// tabularChunker.ts (chunking) for formats that expose real document
// structure instead of a flat string.

export type StructuredBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "list-item"; text: string; ordered: boolean };

export interface TabularSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

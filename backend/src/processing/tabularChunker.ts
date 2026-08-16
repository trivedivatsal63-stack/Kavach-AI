import type { TabularSheet } from "./types";
import type { Chunk } from "./chunker";
import { estimateTokens } from "./chunker";
import { MAX_CHUNK_CHARS, MIN_CHUNK_CHARS } from "../utils/rag.constants";

// Tabular data does not go through the paragraph/heading chunker — a row is
// a self-contained unit of meaning, not prose to be packed by character
// count. Each chunk is one row by default, with headers repeated as context
// in every chunk, so retrieval can pull a single row (e.g. row 50) without
// dragging in the rest of the sheet. Only rows too short to be useful on
// their own get batched with their neighbors (mirrors the tiny-fragment
// merge in chunker.ts's assembleChunks).
export function chunkTabularSheets(sheets: TabularSheet[]): Chunk[] {
  const chunks: Chunk[] = [];

  for (const sheet of sheets) {
    let buffer: string[] = [];
    let bufferLen = 0;

    const flushBuffer = () => {
      if (buffer.length === 0) return;
      const content = buffer.join("\n");
      chunks.push(toChunk(sheet.name, content));
      buffer = [];
      bufferLen = 0;
    };

    for (const row of sheet.rows) {
      const serialized = serializeRow(sheet.name, sheet.headers, row);

      if (serialized.length >= MIN_CHUNK_CHARS) {
        flushBuffer();
        chunks.push(toChunk(sheet.name, serialized));
        continue;
      }

      if (bufferLen + 1 + serialized.length > MAX_CHUNK_CHARS) {
        flushBuffer();
      }
      buffer.push(serialized);
      bufferLen += serialized.length + 1;
    }

    flushBuffer();
  }

  return chunks;
}

function serializeRow(sheetName: string, headers: string[], row: string[]): string {
  const cells = headers.length > 0 ? headers : row.map((_, i) => `col${i + 1}`);
  const parts = cells.map((header, i) => `${header}: ${row[i] ?? ""}`);
  return `Sheet: ${sheetName} | ${parts.join(" | ")}`;
}

function toChunk(sheetName: string, content: string): Chunk {
  return {
    content,
    headingPath: [sheetName],
    page: null,
    tokenCount: estimateTokens(content),
  };
}

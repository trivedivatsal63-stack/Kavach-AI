import { randomUUID } from "crypto";
import { EMBED_BATCH_SIZE, DOCUMENT_STATUS } from "../../utils/rag.constants";
import { extractText, type ExtractedContent } from "../../processing/parsers";
import {
  chunkDocument,
  chunkStructuredBlocks,
  type Chunk,
} from "../../processing/chunker";
import { chunkTabularSheets } from "../../processing/tabularChunker";
import { embedDocuments } from "./embedding.service";
import {
  deleteChunksByDocument,
  insertChunks,
  updateDocumentStatus,
} from "./documents.service";
import { ensureUserCollection, upsertPoints } from "./qdrant.service";

export interface IngestionInput {
  userId: string;
  documentId: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
}

// Full pipeline for one document: parse -> chunk (format-appropriate
// strategy) -> embed -> persist chunks + vectors. Runs inside the in-process
// queue (see queue.ts) so uploads return immediately and a slow embedding
// doesn't block the API.
export async function ingestDocument(input: IngestionInput): Promise<void> {
  await updateDocumentStatus(input.documentId, DOCUMENT_STATUS.PROCESSING);

  try {
    const extracted = await extractText(input.mimeType, input.buffer);
    const { chunks, documentType } = toChunks(extracted);
    if (chunks.length === 0) {
      throw new Error("Document produced no chunks.");
    }

    const collectionName = await ensureUserCollection(input.userId);
    const vectors = await embedInBatches(chunks);
    if (vectors.length !== chunks.length) {
      throw new Error(
        `Embedding service returned ${vectors.length} vectors for ${chunks.length} chunks`
      );
    }

    const chunkIds = chunks.map(() => randomUUID());
    await insertChunks(input.documentId, input.name, chunks, chunkIds);
    await upsertPoints(
      collectionName,
      chunks.map((_chunk, i) => ({
        id: chunkIds[i],
        vector: vectors[i],
        documentId: input.documentId,
        ...(documentType ? { documentType } : {}),
      }))
    );

    await updateDocumentStatus(
      input.documentId,
      DOCUMENT_STATUS.INDEXED,
      null,
      chunks.length
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingestion failed.";
    await updateDocumentStatus(input.documentId, DOCUMENT_STATUS.FAILED, message);
    // Drop any partial chunk rows written before the failure so retries
    // start clean.
    await deleteChunksByDocument(input.documentId).catch(() => {});
    throw err;
  }
}

// Dispatches to the chunking strategy matching what the parser was actually
// able to preserve: flat text falls back to the regex-heuristic chunker,
// DOCX structure drives the block-based chunker directly, and spreadsheet
// rows get their own row-per-chunk strategy (never the paragraph chunker).
function toChunks(extracted: ExtractedContent): {
  chunks: Chunk[];
  documentType?: string;
} {
  switch (extracted.kind) {
    case "text":
      if (!extracted.text.trim()) {
        throw new Error("No extractable text found in this file.");
      }
      return {
        chunks: chunkDocument({
          text: extracted.text,
          pageCount: extracted.pageCount,
        }),
      };
    case "structured":
      return { chunks: chunkStructuredBlocks(extracted.blocks) };
    case "tabular":
      return {
        chunks: chunkTabularSheets(extracted.sheets),
        documentType: "tabular",
      };
  }
}

async function embedInBatches(chunks: Chunk[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks
      .slice(i, i + EMBED_BATCH_SIZE)
      .map((c) => c.content);
    vectors.push(...(await embedDocuments(batch)));
  }
  return vectors;
}

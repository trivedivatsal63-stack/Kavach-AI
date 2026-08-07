import { randomUUID } from "crypto";
import { EMBED_BATCH_SIZE, DOCUMENT_STATUS } from "../../utils/rag.constants";
import { extractText } from "../../processing/parsers";
import { chunkDocument, type Chunk } from "../../processing/chunker";
import { embedDocuments } from "./embedding.service";
import {
  deleteChunksByDocument,
  insertChunks,
  updateDocumentStatus,
} from "./documents.service";
import { ensureCollection, upsertPoints } from "./qdrant.service";

export interface IngestionInput {
  userId: string;
  documentId: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
}

// Full pipeline for one document: parse -> structure-aware chunk -> embed ->
// persist chunks + vectors. Runs inside the in-process queue (see queue.ts)
// so uploads return immediately and a slow embedding doesn't block the API.
export async function ingestDocument(input: IngestionInput): Promise<void> {
  await updateDocumentStatus(input.documentId, DOCUMENT_STATUS.PROCESSING);

  try {
    const { text, pageCount } = await extractText(input.mimeType, input.buffer);
    if (!text.trim()) {
      throw new Error("No extractable text found in this file.");
    }

    const chunks: Chunk[] = chunkDocument({ text, pageCount });
    if (chunks.length === 0) {
      throw new Error("Document produced no chunks.");
    }

    await ensureCollection();
    const vectors = await embedInBatches(chunks);
    if (vectors.length !== chunks.length) {
      throw new Error(
        `Embedding service returned ${vectors.length} vectors for ${chunks.length} chunks`
      );
    }

    const chunkIds = chunks.map(() => randomUUID());
    await insertChunks(input.documentId, input.name, chunks, chunkIds);
    await upsertPoints(
      chunks.map((_chunk, i) => ({
        id: chunkIds[i],
        vector: vectors[i],
        userId: input.userId,
        documentId: input.documentId,
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

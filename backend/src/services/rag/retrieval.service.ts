import { pool } from "../../models/rag/pool";
import {
  DOCUMENT_STATUS,
  DEFAULT_RETRIEVAL_LIMIT,
  MIN_RETRIEVAL_SCORE,
} from "../../utils/rag.constants";
import { embedQueries } from "./embedding.service";
import { deleteDocumentPoints, searchChunks } from "./qdrant.service";
import { getChunksByIds, softDeleteDocument } from "./documents.service";
import type { Citation, RagDocumentRow } from "../../models/rag/types";

// Vector retrieval + document deletion. Retrieval filters strictly on the
// caller's user_id, so users (and public RAG keys) only ever retrieve from
// their own documents. Chunk text is fetched from Postgres by id — Qdrant
// stores only vectors + the user/document payload, keeping one source of
// truth for content.

export async function retrieve(params: {
  userId: string;
  query: string;
  documentIds?: string[];
  limit?: number;
}): Promise<Citation[]> {
  const limit = Math.min(params.limit ?? DEFAULT_RETRIEVAL_LIMIT, 10);
  const [queryVector] = await embedQueries([params.query]);

  const hits = await searchChunks({
    userId: params.userId,
    vector: queryVector,
    limit,
    documentIds: params.documentIds,
  });

  // Drop the weak tail — low cosine similarity means the chunk is unrelated
  // noise, and stuffing it into the prompt invites hallucination.
  const strongHits = hits.filter((h) => h.score >= MIN_RETRIEVAL_SCORE);
  if (strongHits.length === 0) return [];

  const chunksById = await getChunksByIds(strongHits.map((h) => h.chunkId));
  const citations: Citation[] = [];
  for (const hit of strongHits) {
    const chunk = chunksById.get(hit.chunkId);
    if (!chunk) continue;
    citations.push({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      source: chunk.source,
      page: chunk.page,
      headingPath: chunk.headingPath,
      excerpt: truncate(chunk.content, 500),
      score: hit.score,
    });
  }
  return citations;
}

export async function deleteDocument(
  userId: string,
  id: string
): Promise<RagDocumentRow | null> {
  const document = await softDeleteDocument(userId, id);
  if (!document) return null;
  // Best-effort cleanup of the vectors; the Postgres row is already soft
  // deleted so a failure here only leaves orphaned vectors.
  await Promise.allSettled([
    deleteDocumentPoints(id),
    pool.query(`DELETE FROM rag_chunks WHERE document_id = $1`, [id]),
  ]);
  return document;
}

// Documents a user actually has — used to reject documentIds in a query that
// reference someone else's (or nonexistent) documents.
export async function listOwnedDocumentIds(userId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT id FROM rag_documents
     WHERE user_id = $1 AND deleted_at IS NULL AND status = $2`,
    [userId, DOCUMENT_STATUS.INDEXED]
  );
  return result.rows.map((row) => row.id as string);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3).trimEnd()}…`;
}

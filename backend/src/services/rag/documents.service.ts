import { randomUUID } from "crypto";
import { pool } from "../../models/rag/pool";
import { DOCUMENT_STATUS } from "../../utils/rag.constants";
import type { RagChunkRow, RagDocumentRow } from "../../models/rag/types";
import type { Chunk } from "../../processing/chunker";

// CRUD for the RAG module's own tables. All user-scoped queries filter on
// user_id so a user can only ever see their own documents/keys.

export async function listDocuments(userId: string): Promise<RagDocumentRow[]> {
  const result = await pool.query(
    `SELECT id, user_id, name, mime_type, size_bytes, status, error,
            embedding_model, chunk_count, created_at, deleted_at
     FROM rag_documents
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map(rowToDocument);
}

export async function createDocument(input: {
  userId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  embeddingModel: string;
}): Promise<RagDocumentRow> {
  const result = await pool.query(
    `INSERT INTO rag_documents
       (id, user_id, name, mime_type, size_bytes, status, embedding_model)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id, name, mime_type, size_bytes, status, error,
               embedding_model, chunk_count, created_at, deleted_at`,
    [
      randomUUID(),
      input.userId,
      input.name,
      input.mimeType,
      input.sizeBytes,
      DOCUMENT_STATUS.QUEUED,
      input.embeddingModel,
    ]
  );
  return rowToDocument(result.rows[0]);
}

export async function getDocument(
  userId: string,
  id: string
): Promise<RagDocumentRow | null> {
  const result = await pool.query(
    `SELECT id, user_id, name, mime_type, size_bytes, status, error,
            embedding_model, chunk_count, created_at, deleted_at
     FROM rag_documents
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, userId]
  );
  return result.rows[0] ? rowToDocument(result.rows[0]) : null;
}

export async function updateDocumentStatus(
  id: string,
  status: string,
  error: string | null = null,
  chunkCount?: number
): Promise<void> {
  await pool.query(
    `UPDATE rag_documents
     SET status = $2, error = $3, chunk_count = COALESCE($4, chunk_count)
     WHERE id = $1`,
    [id, status, error, chunkCount]
  );
}

// After a restart, jobs that were queued/processing never finished — mark
// them failed so the UI shows the real state instead of a spinner forever.
export async function markInterruptedAsFailed(): Promise<void> {
  await pool.query(
    `UPDATE rag_documents
     SET status = 'failed', error = 'Processing interrupted by a server restart.'
     WHERE status IN ('queued', 'processing')`
  );
}

export async function softDeleteDocument(
  userId: string,
  id: string
): Promise<RagDocumentRow | null> {
  const result = await pool.query(
    `UPDATE rag_documents
     SET deleted_at = now(), status = 'failed',
         error = 'Deleted.'
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING id, user_id, name, mime_type, size_bytes, status, error,
               embedding_model, chunk_count, created_at, deleted_at`,
    [id, userId]
  );
  return result.rows[0] ? rowToDocument(result.rows[0]) : null;
}

export async function deleteChunksByDocument(documentId: string): Promise<void> {
  await pool.query(`DELETE FROM rag_chunks WHERE document_id = $1`, [
    documentId,
  ]);
}

export async function insertChunks(
  documentId: string,
  source: string,
  chunks: Chunk[],
  ids: string[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Idempotent re-ingest: replace the document's previous chunks.
    await client.query("DELETE FROM rag_chunks WHERE document_id = $1", [
      documentId,
    ]);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      await client.query(
        `INSERT INTO rag_chunks
           (id, document_id, chunk_index, heading_path, source, page, token_count, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          ids[i],
          documentId,
          i,
          JSON.stringify(chunk.headingPath),
          source,
          chunk.page,
          chunk.tokenCount,
          chunk.content,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getChunksByIds(ids: string[]): Promise<Map<string, RagChunkRow>> {
  if (ids.length === 0) return new Map();
  const result = await pool.query(
    `SELECT id, document_id, chunk_index, heading_path, source, page, token_count, content
     FROM rag_chunks
     WHERE id = ANY($1::text[])`,
    [ids]
  );
  const map = new Map<string, RagChunkRow>();
  for (const row of result.rows) {
    map.set(row.id, {
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      headingPath: row.heading_path ?? null,
      source: row.source,
      page: row.page ?? null,
      tokenCount: row.token_count,
      content: row.content,
    });
  }
  return map;
}

function rowToDocument(row: {
  id: string;
  user_id: string;
  name: string;
  mime_type: string;
  size_bytes: string | number;
  status: string;
  error: string | null;
  embedding_model: string;
  chunk_count: string | number;
  created_at: Date;
  deleted_at: Date | null;
}): RagDocumentRow {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status as RagDocumentRow["status"],
    error: row.error,
    embeddingModel: row.embedding_model,
    chunkCount: Number(row.chunk_count),
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

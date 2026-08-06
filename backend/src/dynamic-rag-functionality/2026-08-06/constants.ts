// Central constants for the RAG module. Kept in one file so chunking
// behavior, limits, and naming are greppable and consistent everywhere.

export const DOCUMENT_STATUS = {
  QUEUED: "queued",
  PROCESSING: "processing",
  INDEXED: "indexed",
  FAILED: "failed",
} as const;

export const DOCUMENT_STATUSES = Object.values(DOCUMENT_STATUS);

// The embedding model used for every document vector. sentence-transformers/
// paraphrase-multilingual-MiniLM-L12-v2 is multilingual (50+ languages),
// 384-dim, ~470MB — fast on CPU and small enough that GPU acceleration is
// optional. Runs inside the dedicated embedding service, not LiteLLM (see
// embedding/ in the repo root). Must stay in sync with EMBEDDING_MODEL.
export const DEFAULT_EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";
export const DEFAULT_EMBEDDING_DIM = 384;
export const DEFAULT_QDRANT_COLLECTION = "rag_documents";

// Matches litellm/config.yaml's model_name (and VLLM_SERVED_NAME) — same
// single-model hardcode as backend/src/litellm.ts. RAG answers are generated
// through LiteLLM with a per-user key, so the existing credit -> max_budget
// loop also gates RAG spend.
export const RAG_CHAT_MODEL = "qwen2.5-1.5b";

// ── Chunking (characters, not tokens — token count is estimated) ────────
// Structure-aware chunker: paragraphs group up to MAX_CHUNK_CHARS, tables
// stay whole, section changes flush the current chunk so chunks stay aligned
// to the heading tree.
export const MAX_CHUNK_CHARS = 1500;
export const MIN_CHUNK_CHARS = 300;
// Only applied when a single oversized block (e.g. a huge table) must be
// hard-split mid-content — keeps a little context across the cut.
export const MAX_OVERLAP_CHARS = 120;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_UPLOAD_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

export type AllowedUploadMime = (typeof ALLOWED_UPLOAD_MIMES)[number];

// Batch size when embedding many chunks at once — keeps the embedding
// service request bodies reasonable.
export const EMBED_BATCH_SIZE = 32;

export const DEFAULT_RETRIEVAL_LIMIT = 5;

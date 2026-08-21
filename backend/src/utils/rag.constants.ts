// Central constants for the RAG module. Kept in one file so chunking
// behavior, limits, and naming are greppable and consistent everywhere.

import { env } from "../config";

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
export const RAG_CHAT_MODEL = env.ragChatModel;

// ── Chunking (characters, not tokens — token count is estimated) ────────
// Structure-aware chunker: paragraphs group up to MAX_CHUNK_CHARS, tables
// stay whole, section changes flush the current chunk so chunks stay aligned
// to the heading tree. Chunks are deliberately small (~200 tokens) so each
// vector is a tight, self-contained unit of meaning — big chunks dilute the
// embedding and let footnote/reference pages outrank real content.
export const MAX_CHUNK_CHARS = 800;
export const MIN_CHUNK_CHARS = 200;
// Only applied when a single oversized block (e.g. a huge table) must be
// hard-split mid-content — keeps a little context across the cut.
export const MAX_OVERLAP_CHARS = 120;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_UPLOAD_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
] as const;

export type AllowedUploadMime = (typeof ALLOWED_UPLOAD_MIMES)[number];

// Batch size when embedding many chunks at once — keeps the embedding
// service request bodies reasonable.
export const EMBED_BATCH_SIZE = 32;

// Must match vllm's --max-model-len (docker-compose.yml / VLLM_MAX_MODEL_LEN
// in the root .env) — this is the hard ceiling the dynamic token-budget
// retrieval cutoff in retrieval.service.ts is built around. Update both
// together; a mismatch here silently reintroduces context-overflow risk.
export const MODEL_MAX_CONTEXT_TOKENS = env.modelMaxContextTokens;

// Headroom reserved for the model's actual answer. Without this the token
// budget would greedily fill with retrieved context and leave no room to
// respond — LiteLLM computes the remaining output budget as
// max_model_len - input_tokens, so a tight/zero reserve here risks a
// truncated or empty answer even when the input alone technically fits.
export const OUTPUT_TOKEN_RESERVE = 300;

// Vectors scoring below this (Qdrant cosine similarity) are treated as noise
// and dropped. Paraphrase-MiniLM scores relevant chunks well above 0.25 and
// unrelated chunks below it, so this filters the long tail of weak matches.
export const MIN_RETRIEVAL_SCORE = 0.25;

// Section headings under which content is dropped entirely. Books and papers
// bury the real facts in endnote/bibliography sections full of publisher
// names, years, and "Author, Title (Publisher, Year)" lines — those pollute
// retrieval (a reference line matching a name often outranks the title page).
// Matching is case-insensitive; headings like "NOTES" / "Works Cited:" work.
export const JUNK_SECTION_HEADINGS = [
  "notes",
  "endnotes",
  "references",
  "bibliography",
  "works cited",
  "works consulted",
  "footnotes",
  "further reading",
  "sources cited",
  "selected bibliography",
] as const;

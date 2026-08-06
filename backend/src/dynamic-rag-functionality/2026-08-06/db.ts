import { Pool } from "pg";
import { config } from "./config";

// Dedicated PostgreSQL pool for the RAG module's own tables. Uses the same
// DATABASE_URL as Prisma (the "dashboard" database) — the tables below live
// alongside the Prisma-managed ones without touching the existing schema.
export const pool = new Pool({ connectionString: config.databaseUrl });

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS rag_documents (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  status          TEXT NOT NULL,
  error           TEXT,
  embedding_model TEXT NOT NULL,
  chunk_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_rag_documents_user_created
  ON rag_documents (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rag_chunks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL,
  heading_path JSONB,
  source       TEXT NOT NULL,
  page         INTEGER,
  token_count  INTEGER NOT NULL DEFAULT 0,
  content      TEXT NOT NULL,
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_document ON rag_chunks (document_id);

-- User-facing RAG API keys. Follows the ApiKey discipline: the raw key is
-- never stored — only a sha256 hash for lookup and LiteLLM's own hashed
-- token_id for spend/budget management.
CREATE TABLE IF NOT EXISTS rag_keys (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  key_hash   TEXT UNIQUE NOT NULL,
  token_id   TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_rag_keys_user ON rag_keys (user_id, created_at DESC);

-- One hidden per-user chat key (encrypted raw value + hash + token_id) so
-- the platform chat UI spends against the user's balance too.
CREATE TABLE IF NOT EXISTS rag_chat_keys (
  user_id       TEXT PRIMARY KEY,
  token_id      TEXT UNIQUE NOT NULL,
  key_hash      TEXT UNIQUE NOT NULL,
  encrypted_key TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function ensureSchema(): Promise<void> {
  await pool.query(SCHEMA_DDL);
}

import {
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_QDRANT_COLLECTION,
  RAG_CHAT_MODEL,
} from "./constants";

function toPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Environment-derived configuration, read once at module load (same pattern
// as backend/src/litellm.ts). Values are chosen so the module works with
// zero config for local dev, and compose overrides them per-service.
export const config = {
  // Backend/src/db.ts and Prisma share the same DATABASE_URL.
  databaseUrl: process.env.DATABASE_URL,
  qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6333",
  qdrantCollection:
    process.env.QDRANT_COLLECTION ?? DEFAULT_QDRANT_COLLECTION,
  embeddingBaseUrl: process.env.EMBEDDING_BASE_URL ?? "http://localhost:8002",
  embeddingModel: process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
  embeddingDim: toPositiveInt(process.env.EMBEDDING_DIM, DEFAULT_EMBEDDING_DIM),
  litellmBaseUrl: process.env.LITELLM_BASE_URL ?? "http://localhost:4000",
  chatModel: RAG_CHAT_MODEL,
};

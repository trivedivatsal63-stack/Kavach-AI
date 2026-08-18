/**
 * Centralized environment configuration.
 * Loaded once at process start; fail fast on missing required secrets.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: positiveInt("PORT", 4001),
  corsOrigin: optional("CORS_ORIGIN", "http://localhost:5173"),

  databaseUrl: optional(
    "DATABASE_URL",
    "postgresql://postgres:change-me-postgres-password@127.0.0.1:5432/dashboard"
  ),
  jwtSecret: () => required("JWT_SECRET"),

  litellmBaseUrl: optional("LITELLM_BASE_URL", "http://127.0.0.1:4000"),
  litellmMasterKey: () => required("LITELLM_MASTER_KEY"),
  /** Must match litellm/config.yaml model_name and VLLM_SERVED_NAME */
  chatModel: optional("CHAT_MODEL", "qwen2.5-1.5b"),
  /**
   * Direct vLLM URL — used ONLY for tokenizer.service.ts's /tokenize calls.
   * Every actual chat completion still goes through LITELLM_BASE_URL; this
   * is a deliberate, narrow exception because only vLLM's own tokenizer
   * gives real token counts for this model (LiteLLM's /utils/token_counter
   * falls back to a generic tokenizer for self-hosted models — measured
   * ~15% undercount). Do not use this for anything else.
   */
  vllmBaseUrl: optional("VLLM_BASE_URL", "http://127.0.0.1:8000"),

  qdrantUrl: optional("QDRANT_URL", "http://127.0.0.1:6333"),
  qdrantCollection: optional("QDRANT_COLLECTION", "rag_documents"),
  embeddingBaseUrl: optional("EMBEDDING_BASE_URL", "http://127.0.0.1:8002"),
  embeddingModel: optional(
    "EMBEDDING_MODEL",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
  ),
  embeddingDim: positiveInt("EMBEDDING_DIM", 384),

  /** Self-hosted SearXNG instance — see services/liveSearch/. */
  searxngBaseUrl: optional("SEARXNG_URL", "http://127.0.0.1:8888"),

  /**
   * Email promoted to superadmin on boot (and on matching signup/login).
   * Empty means: if no superadmin exists yet, the earliest user is promoted.
   */
  superadminEmail: optional("SUPERADMIN_EMAIL", "").trim().toLowerCase(),
} as const;

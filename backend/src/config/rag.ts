import { env } from "../config";

/** Environment-derived RAG settings (read via central config). */
export const ragConfig = {
  databaseUrl: env.databaseUrl,
  qdrantUrl: env.qdrantUrl,
  qdrantCollection: env.qdrantCollection,
  embeddingBaseUrl: env.embeddingBaseUrl,
  embeddingModel: env.embeddingModel,
  embeddingDim: env.embeddingDim,
  litellmBaseUrl: env.litellmBaseUrl,
  chatModel: env.chatModel,
  vllmBaseUrl: env.vllmBaseUrl,
} as const;

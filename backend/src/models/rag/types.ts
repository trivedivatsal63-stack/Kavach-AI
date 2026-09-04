import {
  DOCUMENT_STATUS,
  type DOCUMENT_STATUSES,
} from "../../utils/rag.constants";
import type { WebCitation } from "../../services/liveSearch/types";

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface RagDocumentRow {
  id: string;
  userId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  error: string | null;
  embeddingModel: string;
  chunkCount: number;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface RagChunkRow {
  id: string;
  documentId: string;
  chunkIndex: number;
  headingPath: string[] | null;
  source: string;
  page: number | null;
  tokenCount: number;
  content: string;
}

export interface RagKeyRow {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  tokenId: string;
  keyPrefix: string;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

// One hidden LiteLLM key per user, used server-side so platform chat spends
// against the user's real balance. The raw value is AES-256-GCM encrypted at
// rest (see crypto.ts) — unlike user-facing keys it must be recoverable.
export interface ChatKeyRow {
  userId: string;
  tokenId: string;
  keyHash: string;
  encryptedKey: string;
  createdAt: Date;
}

export interface Citation {
  chunkId: string;
  documentId: string;
  source: string;
  page: number | null;
  headingPath: string[] | null;
  excerpt: string;
  score: number;
}

export interface RagChatResult {
  answer: string;
  citations: Citation[];
  // Present only when webSearch was requested — see services/liveSearch/.
  webCitations?: WebCitation[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return (
    typeof value === "string" &&
    (Object.values(DOCUMENT_STATUS) as string[]).includes(value)
  );
}

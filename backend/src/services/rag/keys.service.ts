import { createHash, randomUUID } from "crypto";
import { pool } from "../../models/rag/pool";
import {
  generateLiteLLMKey,
  getLiteLLMKeyUsage,
  revokeLiteLLMKey,
} from "../litellm.service";
import type { RagKeyRow } from "../../models/rag/types";

// User-facing RAG API keys, used by the public /v1/rag/query endpoint.
// Same key discipline as the existing ApiKey model: the raw value is shown
// once at creation and never stored — we keep only a sha256 hash (for fast
// lookup of the presented key) and LiteLLM's hashed token_id (for spend and
// budget). Each key IS a real LiteLLM key carrying metadata + max_budget =
// the user's credit balance, so the existing credit -> budget enforcement
// loop also gates RAG queries.

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface CreatedRagKey {
  id: string;
  key: string;
}

const RAG_KEY_COLUMNS =
  "id, user_id, name, key_hash, token_id, key_prefix, expires_at, created_at, revoked_at";

export function ragKeyPrefixFor(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 11) return `${trimmed.slice(0, 3)}…${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

export async function createRagKey(
  userId: string,
  name: string,
  maxBudget: number,
  options?: { expiresAt?: Date | null }
): Promise<CreatedRagKey> {
  const { key, tokenId } = await generateLiteLLMKey(userId, maxBudget, {
    alias: name,
    ...(options?.expiresAt ? { expires: options.expiresAt } : {}),
  });
  const result = await pool.query(
    `INSERT INTO rag_keys (id, user_id, name, key_hash, token_id, key_prefix, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [randomUUID(), userId, name, sha256(key), tokenId, ragKeyPrefixFor(key), options?.expiresAt ?? null]
  );
  return { id: result.rows[0].id, key };
}

export async function resolveRagKey(
  rawKey: string
): Promise<RagKeyRow | null> {
  const result = await pool.query(
    `SELECT ${RAG_KEY_COLUMNS}
     FROM rag_keys
     WHERE key_hash = $1`,
    [sha256(rawKey)]
  );
  const row = result.rows[0];
  if (!row) return null;
  // Local expiry check alongside LiteLLM's native enforcement.
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
  return rowToKey(row);
}

export async function listRagKeys(userId: string): Promise<RagKeyRow[]> {
  const result = await pool.query(
    `SELECT ${RAG_KEY_COLUMNS}
     FROM rag_keys
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map(rowToKey);
}

export async function revokeRagKey(
  userId: string,
  id: string
): Promise<RagKeyRow | null> {
  const result = await pool.query(
    `SELECT ${RAG_KEY_COLUMNS}
     FROM rag_keys
     WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.revoked_at) {
    return rowToKey(row);
  }

  await revokeLiteLLMKey(row.token_id);
  const updated = await pool.query(
    `UPDATE rag_keys SET revoked_at = now() WHERE id = $1 RETURNING ${RAG_KEY_COLUMNS}`,
    [id]
  );
  return rowToKey(updated.rows[0]);
}

export type RagKeyStatus = "active" | "expiring-soon" | "expired" | "revoked";

export function ragKeyStatusFor(key: { revokedAt: Date | null; expiresAt: Date | null }): RagKeyStatus {
  if (key.revokedAt) return "revoked";
  if (!key.expiresAt) return "active";
  if (key.expiresAt.getTime() <= Date.now()) return "expired";
  if (key.expiresAt.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000) return "expiring-soon";
  return "active";
}

// Total spend for a key, pulled live from LiteLLM (no local ledger).
export async function getRagKeySpend(tokenId: string): Promise<number> {
  const usage = await getLiteLLMKeyUsage(tokenId).catch(() => ({
    totalSpend: 0,
    totalRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
  }));
  return usage.totalSpend;
}

function rowToKey(row: {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  token_id: string;
  key_prefix: string | null;
  expires_at: Date | string | null;
  created_at: Date;
  revoked_at: Date | null;
}): RagKeyRow {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyHash: row.key_hash,
    tokenId: row.token_id,
    keyPrefix: row.key_prefix ?? "",
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

import { createHash } from "crypto";
import { pool } from "../../models/rag/pool";
import { decrypt, encrypt } from "../../utils/crypto";
import {
  generateLiteLLMKey,
  updateLiteLLMKeyBudget,
} from "../litellm.service";

// One hidden LiteLLM key per user, used only by the platform chat UI so its
// answers are attributed to the user's real balance (the key's max_budget is
// re-synced to the current credit balance on every chat request). Unlike
// user-facing keys, this raw value must be recoverable server-side, so it is
// AES-256-GCM encrypted at rest — the user never sees it and it can't be
// revoked from the dashboard.

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface ResolvedChatKey {
  tokenId: string;
  rawKey: string;
}

// Returns the user's chat key, minting it on first use. The key's LiteLLM
// budget is (re)set to maxBudget every call — if the key was deleted in
// LiteLLM on the admin side, the update throws and we remint a fresh one.
export async function resolveChatKey(
  userId: string,
  maxBudget: number
): Promise<ResolvedChatKey> {
  const existing = await pool.query(
    `SELECT token_id, encrypted_key FROM rag_chat_keys WHERE user_id = $1`,
    [userId]
  );

  if (existing.rows[0]) {
    const row = existing.rows[0];
    try {
      await updateLiteLLMKeyBudget(row.token_id, maxBudget);
      return { tokenId: row.token_id, rawKey: decrypt(row.encrypted_key) };
    } catch {
      // Fall through and mint a replacement — the old key is gone upstream.
      await pool.query(
        `DELETE FROM rag_chat_keys WHERE user_id = $1`,
        [userId]
      );
    }
  }

  const { key, tokenId } = await generateLiteLLMKey(userId, maxBudget);
  await pool.query(
    `INSERT INTO rag_chat_keys (user_id, token_id, key_hash, encrypted_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, tokenId, sha256(key), encrypt(key)]
  );
  return { tokenId, rawKey: key };
}

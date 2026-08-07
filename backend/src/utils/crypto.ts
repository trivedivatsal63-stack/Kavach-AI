import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { env } from "../config";

// AES-256-GCM at-rest encryption for the server-side RAG chat key. Only that
// key is encrypted — it must be recoverable on every platform chat request.
// User-facing RAG API keys never touch this: they follow the same discipline
// as ApiKey (hash + LiteLLM token_id only).
//
// The encryption key is derived from JWT_SECRET with scrypt (fixed salt is
// fine here — JWT_SECRET is already a high-entropy random secret; the salt's
// job is to slow a dictionary attack, which doesn't apply).

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT = "kavach-rag-chat-key-v1";

function deriveKey(): Buffer {
  return scryptSync(env.jwtSecret(), SALT, 32);
}

export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decrypt(payload: string): string {
  const key = deriveKey();
  const data = Buffer.from(payload, "base64");
  if (data.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Malformed encrypted payload");
  }
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}

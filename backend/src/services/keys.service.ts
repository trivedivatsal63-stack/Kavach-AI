import { createHash } from "crypto";
import { prisma } from "../models/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  generateLiteLLMKey,
  revokeLiteLLMKey,
  testLiteLLMKey,
} from "./litellm.service";

// Max key lifetime: 1 year. Null expiry = never expires.
const MAX_KEY_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export function parseKeyName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().slice(0, 60) : "";
  if (!name) throw new AppError(400, "Key name is required.");
  return name;
}

export function parseKeyExpiry(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, "expiresAt must be a valid date.");
  }
  if (date.getTime() <= Date.now()) {
    throw new AppError(400, "expiresAt must be in the future.");
  }
  if (date.getTime() - Date.now() > MAX_KEY_LIFETIME_MS) {
    throw new AppError(400, "Key lifetime cannot exceed 1 year.");
  }
  return date;
}

/** Non-secret identifier (OpenAI-dashboard style) — safe to list forever. */
export function keyPrefixFor(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 11) return `${trimmed.slice(0, 3)}…${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

export type KeyStatus = "active" | "expiring-soon" | "expired" | "revoked";

export function keyStatusFor(key: { revokedAt: Date | null; expiresAt: Date | null }): KeyStatus {
  if (key.revokedAt) return "revoked";
  if (!key.expiresAt) return "active";
  if (key.expiresAt.getTime() <= Date.now()) return "expired";
  if (key.expiresAt.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000) return "expiring-soon";
  return "active";
}

export async function createKey(
  userId: string,
  input?: { name?: unknown; expiresAt?: unknown }
) {
  const name = input?.name !== undefined ? parseKeyName(input.name) : "API key";
  const expiresAt = parseKeyExpiry(input?.expiresAt);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const maxBudget = user.creditBalanceUsd.toNumber();

  const { key, tokenId } = await generateLiteLLMKey(userId, maxBudget, {
    alias: name,
    ...(expiresAt ? { expires: expiresAt } : {}),
  });
  const apiKey = await prisma.apiKey.create({
    data: { userId, litellmKeyId: tokenId, name, keyPrefix: keyPrefixFor(key), expiresAt },
  });

  return {
    id: apiKey.id,
    key,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    expiresAt: apiKey.expiresAt,
    createdAt: apiKey.createdAt,
  };
}

export async function listKeys(userId: string) {
  const apiKeys = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return apiKeys.map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    expiresAt: k.expiresAt,
    status: keyStatusFor(k),
    createdAt: k.createdAt,
    revokedAt: k.revokedAt,
  }));
}

export async function renameKey(userId: string, id: string, rawName: unknown) {
  const name = parseKeyName(rawName);
  const apiKey = await prisma.apiKey.findUnique({ where: { id } });
  if (!apiKey || apiKey.userId !== userId) {
    throw new AppError(404, "Key not found.");
  }
  const updated = await prisma.apiKey.update({ where: { id }, data: { name } });
  return { id: updated.id, name: updated.name };
}

export async function revokeKey(userId: string, id: string) {
  const apiKey = await prisma.apiKey.findUnique({ where: { id } });
  if (!apiKey || apiKey.userId !== userId) {
    throw new AppError(404, "Key not found.");
  }
  if (apiKey.revokedAt) {
    throw new AppError(409, "Key already revoked.");
  }

  await revokeLiteLLMKey(apiKey.litellmKeyId);
  const updated = await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  return { id: updated.id, revokedAt: updated.revokedAt };
}

export async function findUserByPresentedApiKey(rawKey: string) {
  const hash = createHash("sha256").update(rawKey).digest("hex");
  const apiKey = await prisma.apiKey.findFirst({
    // Belt-and-braces alongside LiteLLM's native expiry enforcement:
    // revoked or locally-expired keys resolve to nobody even if LiteLLM
    // hiccups.
    where: {
      AND: [
        { OR: [{ litellmKeyId: hash }, { litellmKeyId: rawKey }] },
        { revokedAt: null },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      ],
    },
    select: {
      user: { select: { id: true, status: true, deletedAt: true } },
    },
  });
  return apiKey?.user ?? null;
}

export async function testKey(apiKey: string, message?: string) {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new AppError(400, "apiKey is required.");
  }

  const prompt =
    typeof message === "string" && message.trim()
      ? message.trim()
      : "Say hello in one sentence.";

  const startedAt = Date.now();
  const result = await testLiteLLMKey(trimmed, prompt);
  const latencyMs = Date.now() - startedAt;

  if (!result.ok) {
    // Never forward LiteLLM's 401 here — the dashboard JWT uses 401 for
    // session expiry, and the frontend logs the user out on that status.
    // An invalid *API key* is a validation problem, not a logged-out session.
    if (result.status === 401 || result.status === 403) {
      throw new AppError(
        400,
        "Invalid API key. Enter a valid key and try again."
      );
    }
    if (result.status === 402 || result.status === 429) {
      throw new AppError(
        402,
        result.errorMessage ??
          "This key is out of credits or rate-limited."
      );
    }
    if (result.status >= 500) {
      throw new AppError(
        502,
        result.errorMessage ?? "Inference gateway error."
      );
    }
    throw new AppError(
      400,
      result.errorMessage ?? "Key test failed. Enter a valid API key."
    );
  }

  return {
    reply: result.reply,
    latencyMs,
    promptTokens: result.promptTokens ?? null,
    completionTokens: result.completionTokens ?? null,
    totalTokens: result.totalTokens ?? null,
  };
}

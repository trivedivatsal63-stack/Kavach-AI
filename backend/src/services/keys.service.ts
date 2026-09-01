import { createHash } from "crypto";
import { prisma } from "../models/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  generateLiteLLMKey,
  revokeLiteLLMKey,
  testLiteLLMKey,
} from "./litellm.service";

export async function createKey(
  userId: string,
  opts: { scope?: string; name?: string; expiresAt?: Date | null; duration?: string } = {}
) {
  const { scope = "general", name, expiresAt, duration } = opts;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const maxBudget = user.creditBalanceUsd.toNumber();

  const { key, tokenId } = await generateLiteLLMKey(userId, maxBudget, {
    duration,
    keyAlias: name,
  });
  const apiKey = await prisma.apiKey.create({
    data: { userId, litellmKeyId: tokenId, scope, name: name?.trim() || null, expiresAt },
  });

  return {
    id: apiKey.id,
    key,
    createdAt: apiKey.createdAt,
    name: apiKey.name,
    scope: apiKey.scope,
    expiresAt: apiKey.expiresAt,
  };
}

export async function listKeys(userId: string) {
  const apiKeys = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return apiKeys.map((k) => ({
    id: k.id,
    name: (k as any).name ?? null,
    scope: (k as any).scope ?? "general",
    expiresAt: (k as any).expiresAt ?? null,
    createdAt: k.createdAt,
    revokedAt: k.revokedAt,
  }));
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
    where: {
      OR: [{ litellmKeyId: hash }, { litellmKeyId: rawKey }],
      revokedAt: null,
    },
    select: {
      user: { select: { id: true, status: true, deletedAt: true } },
      expiresAt: true,
    },
  });
  if (!apiKey) return null;
  if ((apiKey as any).expiresAt && new Date((apiKey as any).expiresAt) < new Date()) return null;
  return apiKey.user ?? null;
}

export async function isApiKeyExpiredByRaw(rawKey: string): Promise<boolean> {
  const hash = createHash("sha256").update(rawKey).digest("hex");
  const row = await prisma.apiKey.findFirst({ where: { OR: [{ litellmKeyId: hash }, { litellmKeyId: rawKey }] }, select: { expiresAt: true } });
  if (!row || !(row as any).expiresAt) return false;
  return new Date((row as any).expiresAt) < new Date();
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

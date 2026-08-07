import { prisma } from "../models/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  generateLiteLLMKey,
  revokeLiteLLMKey,
  testLiteLLMKey,
} from "./litellm.service";

export async function createKey(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const maxBudget = user.creditBalanceUsd.toNumber();

  const { key, tokenId } = await generateLiteLLMKey(userId, maxBudget);
  const apiKey = await prisma.apiKey.create({
    data: { userId, litellmKeyId: tokenId },
  });

  return {
    id: apiKey.id,
    key,
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
    throw new AppError(result.status, result.errorMessage ?? "Key test failed.");
  }

  return {
    reply: result.reply,
    latencyMs,
    promptTokens: result.promptTokens ?? null,
    completionTokens: result.completionTokens ?? null,
    totalTokens: result.totalTokens ?? null,
  };
}

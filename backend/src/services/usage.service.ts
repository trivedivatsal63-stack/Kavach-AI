import { prisma } from "../models/prisma";
import { getLiteLLMKeyUsage } from "./litellm.service";

export async function getUsage(userId: string) {
  const apiKeys = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return Promise.all(
    apiKeys.map(async (k) => {
      const usage = await getLiteLLMKeyUsage(k.litellmKeyId).catch(() => ({
        totalSpend: 0,
        totalRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
      }));
      return {
        keyId: k.id,
        createdAt: k.createdAt,
        revokedAt: k.revokedAt,
        ...usage,
      };
    })
  );
}

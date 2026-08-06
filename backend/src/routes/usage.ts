import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { getLiteLLMKeyUsage } from "../litellm";

export const usageRouter = Router();
usageRouter.use(requireAuth);

// Pulled live from LiteLLM's /spend/logs/v2 per key on every request — no
// local usage ledger, LiteLLM stays the single source of truth.
usageRouter.get("/", async (req, res) => {
  const userId = req.userId!;
  const apiKeys = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const rows = await Promise.all(
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

  res.json(rows);
});

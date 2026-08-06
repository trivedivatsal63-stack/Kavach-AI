import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { generateLiteLLMKey, revokeLiteLLMKey } from "../litellm";

export const keysRouter = Router();
keysRouter.use(requireAuth);

keysRouter.post("/", async (req, res) => {
  const userId = req.userId!;

  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // The key's real spending cap in LiteLLM is set from the user's
    // current credit balance, not a static config default — that's what
    // makes the balance an actual enforcement mechanism, not cosmetic.
    const maxBudget = user.creditBalanceUsd.toNumber();

    const { key, tokenId } = await generateLiteLLMKey(userId, maxBudget);
    const apiKey = await prisma.apiKey.create({
      data: { userId, litellmKeyId: tokenId },
    });

    // The raw key is returned here and only here — it is never written to
    // our database, so this is the one and only chance to show it.
    res.status(201).json({
      id: apiKey.id,
      key,
      createdAt: apiKey.createdAt,
    });
  } catch (err) {
    console.error("POST /keys failed:", err);
    res.status(500).json({ error: "Failed to generate key." });
  }
});

keysRouter.get("/", async (req, res) => {
  const userId = req.userId!;
  const apiKeys = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    apiKeys.map((k) => ({
      id: k.id,
      createdAt: k.createdAt,
      revokedAt: k.revokedAt,
    }))
  );
});

keysRouter.delete("/:id", async (req, res) => {
  const userId = req.userId!;
  const { id } = req.params;

  const apiKey = await prisma.apiKey.findUnique({ where: { id } });
  if (!apiKey || apiKey.userId !== userId) {
    res.status(404).json({ error: "Key not found." });
    return;
  }
  if (apiKey.revokedAt) {
    res.status(409).json({ error: "Key already revoked." });
    return;
  }

  try {
    await revokeLiteLLMKey(apiKey.litellmKeyId);
    const updated = await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    res.json({ id: updated.id, revokedAt: updated.revokedAt });
  } catch (err) {
    console.error("DELETE /keys/:id failed:", err);
    res.status(500).json({ error: "Failed to revoke key." });
  }
});

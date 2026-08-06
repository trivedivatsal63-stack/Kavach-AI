import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { generateLiteLLMKey, revokeLiteLLMKey, testLiteLLMKey } from "../litellm";

export const keysRouter = Router();
keysRouter.use(requireAuth);

// Lets a logged-in user test any key (not necessarily one of their own —
// e.g. pasting one in to sanity-check it) against a real completion,
// without curl/Postman. The tested key is never logged or persisted: it
// only ever appears in the outgoing Authorization header below.
keysRouter.post("/test", async (req, res) => {
  const apiKey =
    typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const message =
    typeof req.body?.message === "string" && req.body.message.trim()
      ? req.body.message.trim()
      : "Say hello in one sentence.";

  if (!apiKey) {
    res.status(400).json({ error: "apiKey is required." });
    return;
  }

  const startedAt = Date.now();
  try {
    const result = await testLiteLLMKey(apiKey, message);
    const latencyMs = Date.now() - startedAt;

    if (!result.ok) {
      res.status(result.status).json({ error: result.errorMessage });
      return;
    }

    res.json({
      reply: result.reply,
      latencyMs,
      promptTokens: result.promptTokens ?? null,
      completionTokens: result.completionTokens ?? null,
      totalTokens: result.totalTokens ?? null,
    });
  } catch (err) {
    // err is a network/fetch-level exception here — it never contains the
    // key, which only ever went out in a request header, not this catch.
    console.error("POST /keys/test failed:", err);
    res.status(502).json({ error: "Failed to reach the inference gateway." });
  }
});

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

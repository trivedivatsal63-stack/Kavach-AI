import { Router } from "express";
import { prisma } from "../../../db";
import { requireAuth } from "../../../auth";
import {
  createRagKey,
  getRagKeySpend,
  listRagKeys,
  revokeRagKey,
} from "../services/ragKeys";

export const keysRouter = Router();
keysRouter.use(requireAuth);

// RAG API keys for the public /v1/rag/query endpoint. Each is a real
// LiteLLM key whose max_budget is the user's current credit balance, so RAG
// queries consume the same credit pool as regular chat completions.

keysRouter.post("/", async (req, res) => {
  const userId = req.userId!;
  const name = String(req.body?.name ?? "")
    .trim()
    .slice(0, 100);

  if (!name) {
    res.status(400).json({ error: "Name is required." });
    return;
  }

  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const maxBudget = user.creditBalanceUsd.toNumber();
    const created = await createRagKey(userId, name, maxBudget);

    // Raw key is shown once and never stored — same discipline as /keys.
    res.status(201).json({
      id: created.id,
      key: created.key,
      name,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("POST /rag/keys failed:", err);
    res.status(500).json({ error: "Failed to create RAG key." });
  }
});

keysRouter.get("/", async (req, res) => {
  try {
    const keys = await listRagKeys(req.userId!);
    const rows = await Promise.all(
      keys.map(async (k) => ({
        id: k.id,
        name: k.name,
        createdAt: k.createdAt,
        revokedAt: k.revokedAt,
        spend: await getRagKeySpend(k.tokenId),
      }))
    );
    res.json({ keys: rows });
  } catch (err) {
    console.error("GET /rag/keys failed:", err);
    res.status(500).json({ error: "Failed to list RAG keys." });
  }
});

keysRouter.delete("/:id", async (req, res) => {
  try {
    const revoked = await revokeRagKey(req.userId!, req.params.id);
    if (!revoked) {
      res.status(404).json({ error: "Key not found." });
      return;
    }
    res.json({ id: revoked.id, revokedAt: revoked.revokedAt });
  } catch (err) {
    console.error("DELETE /rag/keys/:id failed:", err);
    res.status(500).json({ error: "Failed to revoke RAG key." });
  }
});

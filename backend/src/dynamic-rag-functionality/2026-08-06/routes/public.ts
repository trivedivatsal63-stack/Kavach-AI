import { Router } from "express";
import { prisma } from "../../../db";
import { updateLiteLLMKeyBudget } from "../../../litellm";
import { resolveRagKey } from "../services/ragKeys";
import { answerQuestion } from "../services/chat";
import { RagCompletionError } from "../services/litellm";
import { filterOwnedDocumentIds } from "./chat";

export const publicRouter = Router();

// Public RAG query endpoint. Authenticated with a RAG API key (Bearer),
// which is both the lookup credential AND the LiteLLM key used for
// generation — so the presented key's budget/spend is enforced exactly like
// any other key. No JWT involved, so it's safe to call from servers/scripts.
publicRouter.post("/v1/rag/query", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }
  const rawKey = header.slice("Bearer ".length).trim();
  if (!rawKey) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  const ragKey = await resolveRagKey(rawKey).catch(() => null);
  if (!ragKey || ragKey.revokedAt) {
    res.status(401).json({ error: "Invalid or revoked RAG key." });
    return;
  }

  const question = String(req.body?.question ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "Question is required." });
    return;
  }
  if (question.length > 4000) {
    res.status(400).json({ error: "Question is too long." });
    return;
  }

  const providedIds: string[] = Array.isArray(req.body?.documentIds)
    ? req.body.documentIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  try {
    const user = await prisma.user.findUnique({ where: { id: ragKey.userId } });
    if (!user) {
      res.status(401).json({ error: "Invalid or revoked RAG key." });
      return;
    }

    // Keep the key's real LiteLLM budget in sync with the current balance so
    // top-ups/deductions apply to RAG keys too (mirrors /credits/topup).
    const balance = user.creditBalanceUsd.toNumber();
    await updateLiteLLMKeyBudget(ragKey.tokenId, balance).catch(() => {});

    const documentIds = await filterOwnedDocumentIds(ragKey.userId, providedIds);
    const result = await answerQuestion({
      userId: ragKey.userId,
      question,
      documentIds,
      apiKey: rawKey,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof RagCompletionError) {
      res.status(mapCompletionStatus(err.status)).json({ error: err.message });
      return;
    }
    console.error("POST /v1/rag/query failed:", err);
    res.status(500).json({ error: "Failed to answer question." });
  }
});

function mapCompletionStatus(status: number): number {
  if (status === 401) return 401;
  if (status === 402 || status === 429) return 402; // out of credits
  return 502;
}

import { Router } from "express";
import { prisma } from "../../../db";
import { requireAuth } from "../../../auth";
import { resolveChatKey } from "../services/chatKeys";
import { answerQuestion } from "../services/chat";
import { RagCompletionError } from "../services/litellm";
import { listOwnedDocumentIds } from "../services/retrieval";

export const chatRouter = Router();
chatRouter.use(requireAuth);

// Platform chat UI surface. Generates against the user's hidden chat key
// (minted + budget-synced to the credit balance on demand), so chat spend
// shows up in the same credit pool as everything else.
chatRouter.post("/", async (req, res) => {
  const userId = req.userId!;
  const question = String(req.body?.question ?? "").trim();
  const providedIds: string[] = Array.isArray(req.body?.documentIds)
    ? req.body.documentIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  if (!question) {
    res.status(400).json({ error: "Question is required." });
    return;
  }
  if (question.length > 4000) {
    res.status(400).json({ error: "Question is too long." });
    return;
  }

  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const balance = user.creditBalanceUsd.toNumber();

    const documentIds = await filterOwnedDocumentIds(userId, providedIds);
    const { rawKey } = await resolveChatKey(userId, balance);
    const result = await answerQuestion({ userId, question, documentIds, apiKey: rawKey });

    res.json(result);
  } catch (err) {
    if (err instanceof RagCompletionError) {
      res.status(mapCompletionStatus(err.status)).json({ error: err.message });
      return;
    }
    console.error("POST /rag/chat failed:", err);
    res.status(500).json({ error: "Failed to answer question." });
  }
});

export async function filterOwnedDocumentIds(
  userId: string,
  providedIds: string[]
): Promise<string[] | undefined> {
  if (providedIds.length === 0) return undefined;
  const owned = new Set(await listOwnedDocumentIds(userId));
  return providedIds.filter((id) => owned.has(id));
}

function mapCompletionStatus(status: number): number {
  if (status === 401) return 401;
  if (status === 402 || status === 429) return 402; // out of credits
  return 502;
}

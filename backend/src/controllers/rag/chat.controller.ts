import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../models/prisma";
import { resolveChatKey } from "../../services/rag/chatKeys.service";
import { answerQuestion } from "../../services/rag/chat.service";
import { RagCompletionError } from "../../services/rag/completion.service";
import { listOwnedDocumentIds } from "../../services/rag/retrieval.service";
import { AppError } from "../../middleware/errorHandler";

export async function chat(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const question = String(req.body?.question ?? "").trim();
    const providedIds: string[] = Array.isArray(req.body?.documentIds)
      ? req.body.documentIds.filter(
          (id: unknown): id is string => typeof id === "string"
        )
      : [];

    if (!question) {
      throw new AppError(400, "Question is required.");
    }
    if (question.length > 4000) {
      throw new AppError(400, "Question is too long.");
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const balance = user.creditBalanceUsd.toNumber();

    const documentIds = await filterOwnedDocumentIds(userId, providedIds);
    const { rawKey } = await resolveChatKey(userId, balance);
    const result = await answerQuestion({
      userId,
      question,
      documentIds,
      apiKey: rawKey,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof RagCompletionError) {
      next(new AppError(mapCompletionStatus(err.status), err.message));
      return;
    }
    if (!(err instanceof AppError)) {
      console.error("POST /rag/chat failed:", err);
      next(new AppError(500, "Failed to answer question."));
      return;
    }
    next(err);
  }
}

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
  if (status === 402 || status === 429) return 402;
  return 502;
}

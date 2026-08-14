import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../models/prisma";
import { updateLiteLLMKeyBudget } from "../../services/litellm.service";
import { resolveRagKey } from "../../services/rag/keys.service";
import { answerQuestion } from "../../services/rag/chat.service";
import {
  CompletionError,
  mapCompletionErrorStatus,
} from "../../services/rag/completion.service";
import { filterOwnedDocumentIds } from "./chat.controller";
import { AppError } from "../../middleware/errorHandler";

export async function query(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(401, "Missing bearer token.");
    }
    const rawKey = header.slice("Bearer ".length).trim();
    if (!rawKey) {
      throw new AppError(401, "Missing bearer token.");
    }

    const ragKey = await resolveRagKey(rawKey).catch(() => null);
    if (!ragKey || ragKey.revokedAt) {
      throw new AppError(401, "Invalid or revoked RAG key.");
    }

    const question = String(req.body?.question ?? "").trim();
    if (!question) {
      throw new AppError(400, "Question is required.");
    }
    if (question.length > 4000) {
      throw new AppError(400, "Question is too long.");
    }

    const providedIds: string[] = Array.isArray(req.body?.documentIds)
      ? req.body.documentIds.filter(
          (id: unknown): id is string => typeof id === "string"
        )
      : [];

    const user = await prisma.user.findUnique({ where: { id: ragKey.userId } });
    if (!user) {
      throw new AppError(401, "Invalid or revoked RAG key.");
    }

    const balance = user.creditBalanceUsd.toNumber();
    await updateLiteLLMKeyBudget(ragKey.tokenId, balance).catch(() => {});

    const documentIds = await filterOwnedDocumentIds(ragKey.userId, providedIds);
    const result = await answerQuestion({
      userId: ragKey.userId,
      question,
      documentIds,
      apiKey: rawKey,
      webSearch: req.body?.webSearch === true,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof CompletionError) {
      next(new AppError(mapCompletionErrorStatus(err.status), err.message));
      return;
    }
    if (!(err instanceof AppError)) {
      console.error("POST /v1/rag/query failed:", err);
      next(new AppError(500, "Failed to answer question."));
      return;
    }
    next(err);
  }
}

import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../models/prisma";
import {
  createRagKey,
  getRagKeySpend,
  listRagKeys,
  revokeRagKey,
} from "../../services/rag/keys.service";
import { AppError } from "../../middleware/errorHandler";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const name = String(req.body?.name ?? "")
      .trim()
      .slice(0, 100);

    if (!name) {
      throw new AppError(400, "Name is required.");
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const maxBudget = user.creditBalanceUsd.toNumber();
    const created = await createRagKey(userId, name, maxBudget);

    res.status(201).json({
      id: created.id,
      key: created.key,
      name,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    if (!(err instanceof AppError)) {
      console.error("POST /rag/keys failed:", err);
      next(new AppError(500, "Failed to create RAG key."));
      return;
    }
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
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
    next(new AppError(500, "Failed to list RAG keys."));
  }
}

export async function revoke(req: Request, res: Response, next: NextFunction) {
  try {
    const revoked = await revokeRagKey(req.userId!, String(req.params.id));
    if (!revoked) {
      throw new AppError(404, "Key not found.");
    }
    res.json({ id: revoked.id, revokedAt: revoked.revokedAt });
  } catch (err) {
    if (!(err instanceof AppError)) {
      console.error("DELETE /rag/keys/:id failed:", err);
      next(new AppError(500, "Failed to revoke RAG key."));
      return;
    }
    next(err);
  }
}

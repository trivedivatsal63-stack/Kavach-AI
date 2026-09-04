import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../models/prisma";
import {
  createRagKey,
  getRagKeySpend,
  listRagKeys,
  ragKeyStatusFor,
  revokeRagKey,
} from "../../services/rag/keys.service";
import { parseKeyExpiry } from "../../services/keys.service";
import { AppError } from "../../middleware/errorHandler";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const name = String(req.body?.name ?? "")
      .trim()
      .slice(0, 60);

    if (!name) {
      throw new AppError(400, "Name is required.");
    }

    const expiresAt = parseKeyExpiry(req.body?.expiresAt);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const maxBudget = user.creditBalanceUsd.toNumber();
    const created = await createRagKey(userId, name, maxBudget, { expiresAt });

    res.status(201).json({
      id: created.id,
      key: created.key,
      name,
      expiresAt: expiresAt?.toISOString() ?? null,
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
        keyPrefix: k.keyPrefix,
        expiresAt: k.expiresAt,
        status: ragKeyStatusFor(k),
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

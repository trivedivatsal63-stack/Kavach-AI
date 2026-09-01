import type { Request, Response, NextFunction } from "express";
import * as keysService from "../services/keys.service";
import { AppError } from "../middleware/errorHandler";

export async function test(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey =
      typeof req.body?.apiKey === "string" ? req.body.apiKey : "";
    const message =
      typeof req.body?.message === "string" ? req.body.message : undefined;
    const result = await keysService.testKey(apiKey, message);
    res.json(result);
  } catch (err) {
    if (err instanceof AppError && err.status >= 500) {
      console.error("POST /keys/test failed:", err);
    }
    if (!(err instanceof AppError) && !(err instanceof Error && "status" in err)) {
      console.error("POST /keys/test failed:", err);
      next(new AppError(502, "Failed to reach the inference gateway."));
      return;
    }
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = typeof req.body?.scope === "string" ? req.body.scope : "general";
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : undefined;
    const expiresIn = typeof req.body?.expiresIn === "string" ? req.body.expiresIn : typeof req.body?.expiresAt === "string" ? req.body.expiresAt : null;
    // expiresIn: "7d" | "30d" | "90d" | "365d" | "never" or ISO date
    let expiresAt: Date | null = null;
    let duration: string | undefined;
    if (expiresIn && expiresIn !== "never") {
      const map: Record<string, string> = { "7d": "7d", "30d": "30d", "90d": "90d", "365d": "365d", "1y": "365d" };
      if (map[expiresIn]) {
        duration = map[expiresIn];
        const days = expiresIn === "7d" ? 7 : expiresIn === "30d" ? 30 : expiresIn === "90d" ? 90 : 365;
        expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);
      } else {
        const d = new Date(expiresIn);
        if (!isNaN(d.getTime()) && d > new Date()) { expiresAt = d; duration = undefined; }
      }
    }
    const result = await keysService.createKey(req.userId!, { scope, name, expiresAt, duration });
    res.status(201).json(result);
  } catch (err) {
    console.error("POST /keys failed:", err);
    if (err instanceof AppError) {
      next(err);
      return;
    }
    const detail = err instanceof Error ? err.message : undefined;
    next(
      new AppError(
        500,
        detail ? `Failed to generate key: ${detail}` : "Failed to generate key."
      )
    );
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await keysService.listKeys(req.userId!));
  } catch (err) {
    next(err);
  }
}

export async function revoke(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await keysService.revokeKey(req.userId!, String(req.params.id)));
  } catch (err) {
    console.error("DELETE /keys/:id failed:", err);
    next(err instanceof AppError ? err : new AppError(500, "Failed to revoke key."));
  }
}

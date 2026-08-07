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
    const result = await keysService.createKey(req.userId!);
    res.status(201).json(result);
  } catch (err) {
    console.error("POST /keys failed:", err);
    next(
      err instanceof AppError
        ? err
        : new AppError(500, "Failed to generate key.")
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

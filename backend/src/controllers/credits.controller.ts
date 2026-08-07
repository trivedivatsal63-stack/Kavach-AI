import type { Request, Response, NextFunction } from "express";
import * as creditsService from "../services/credits.service";
import { AppError } from "../middleware/errorHandler";

export async function topup(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await creditsService.topUp(req.userId!));
  } catch (err) {
    console.error("POST /credits/topup failed:", err);
    next(err instanceof AppError ? err : new AppError(500, "Failed to top up credits."));
  }
}

import type { Request, Response, NextFunction } from "express";
import * as usageService from "../services/usage.service";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await usageService.getUsage(req.userId!));
  } catch (err) {
    next(err);
  }
}

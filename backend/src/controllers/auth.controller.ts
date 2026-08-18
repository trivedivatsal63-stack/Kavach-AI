import type { Request, Response, NextFunction } from "express";
import * as authService from "../services/auth.service";

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.signup({
      email: String(req.body?.email ?? ""),
      password: String(req.body?.password ?? ""),
      name: String(req.body?.name ?? ""),
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.login({
      email: String(req.body?.email ?? ""),
      password: String(req.body?.password ?? ""),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await authService.me(req.userId!));
  } catch (err) {
    next(err);
  }
}

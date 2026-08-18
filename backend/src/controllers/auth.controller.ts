import type { Request, Response, NextFunction } from "express";
import * as authService from "../services/auth.service";

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.signup({
      email: req.body?.email,
      password: req.body?.password,
      name: req.body?.name,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.login({
      email: req.body?.email,
      password: req.body?.password,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function verifyOtp(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const result = await authService.verifyOtp({
      email: req.body?.email,
      purpose: req.body?.purpose,
      code: req.body?.code,
    });
    const status = req.body?.purpose === "signup" ? 201 : 200;
    res.status(status).json(result);
  } catch (err) {
    next(err);
  }
}

export async function resendOtp(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(
      await authService.resendOtp({
        email: req.body?.email,
        purpose: req.body?.purpose,
      })
    );
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(await authService.forgotPassword({ email: req.body?.email }));
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(
      await authService.resetPassword({
        email: req.body?.email,
        code: req.body?.code,
        password: req.body?.password,
      })
    );
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

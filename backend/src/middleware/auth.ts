import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config";

export interface JwtPayload {
  userId: string;
}

export function signJwt(payload: JwtPayload): string {
  // Session lifetime for dashboard JWT (Bearer). Clients store this in localStorage.
  return jwt.sign(payload, env.jwtSecret(), { expiresIn: "7h" });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const token = header.slice("Bearer ".length);
  try {
    const decoded = jwt.verify(token, env.jwtSecret()) as JwtPayload;
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

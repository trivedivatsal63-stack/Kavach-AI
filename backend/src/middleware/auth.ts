import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config";
import { prisma } from "../models/prisma";
import { isUuid } from "../utils/uuid";
import { isSuperadmin, USER_STATUS } from "../utils/roles";

export interface JwtPayload {
  userId: string;
}

export interface AuthedUser {
  id: string;
  role: string;
  status: string;
  deletedAt: Date | null;
}

export function signJwt(payload: JwtPayload): string {
  if (!isUuid(payload.userId)) {
    throw new Error("JWT userId must be a UUID");
  }
  // Session lifetime for dashboard JWT (Bearer). Clients store this in localStorage.
  return jwt.sign(payload, env.jwtSecret(), { expiresIn: "7h" });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      authedUser?: AuthedUser;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const token = header.slice("Bearer ".length);
  try {
    const decoded = jwt.verify(token, env.jwtSecret()) as JwtPayload;
    if (!decoded.userId || !isUuid(decoded.userId)) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    // Live DB check — role/status changes take effect without waiting for
    // the 7h JWT to expire. Deleted accounts look like a dead session so
    // the client clears localStorage via the existing 401 handler.
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, status: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    if (user.status === USER_STATUS.BLOCKED) {
      res.status(403).json({ error: "This account has been blocked." });
      return;
    }

    req.userId = user.id;
    req.authedUser = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Blocks spend-creating actions for paused accounts. Run after requireAuth. */
export function requireActiveAccount(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (req.authedUser?.status === USER_STATUS.PAUSED) {
    res.status(403).json({
      error: "This account is paused. Contact an administrator.",
    });
    return;
  }
  next();
}

/** Superadmin gate. Always re-reads role from the row attached by requireAuth. */
export function requireSuperadmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.authedUser || !isSuperadmin(req.authedUser.role)) {
    res.status(403).json({ error: "Superadmin access required." });
    return;
  }
  next();
}

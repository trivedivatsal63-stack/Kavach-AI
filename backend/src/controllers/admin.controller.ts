import type { Request, Response, NextFunction } from "express";
import * as adminService from "../services/admin.service";

export async function listUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const includeDeleted = req.query.includeDeleted === "true";
    res.json(await adminService.listUsers({ q, includeDeleted }));
  } catch (err) {
    next(err);
  }
}

export async function getUser(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await adminService.getUserActivity(String(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function pauseUser(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await adminService.pauseUser(req.userId!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function unpauseUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(await adminService.unpauseUser(req.userId!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function blockUser(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await adminService.blockUser(req.userId!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function unblockUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(await adminService.unblockUser(req.userId!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await adminService.softDeleteUser(req.userId!, String(req.params.id))
    );
  } catch (err) {
    next(err);
  }
}

export async function restoreUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(await adminService.restoreUser(req.userId!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function revokeKey(req: Request, res: Response, next: NextFunction) {
  try {
    const kind = req.body?.kind === "rag" ? "rag" : "api";
    res.json(
      await adminService.revokeUserKey(
        req.userId!,
        String(req.params.id),
        String(req.params.keyId),
        kind
      )
    );
  } catch (err) {
    next(err);
  }
}

export async function revokeAllKeys(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(
      await adminService.revokeAllUserKeys(req.userId!, String(req.params.id))
    );
  } catch (err) {
    next(err);
  }
}

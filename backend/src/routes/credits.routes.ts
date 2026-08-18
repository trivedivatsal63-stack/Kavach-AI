import { Router } from "express";
import { requireAuth, requireActiveAccount } from "../middleware/auth";
import * as creditsController from "../controllers/credits.controller";

export const creditsRouter = Router();

creditsRouter.post(
  "/topup",
  requireAuth,
  requireActiveAccount,
  creditsController.topup
);

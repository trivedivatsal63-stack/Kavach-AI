import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as creditsController from "../controllers/credits.controller";

export const creditsRouter = Router();

creditsRouter.post("/topup", requireAuth, creditsController.topup);

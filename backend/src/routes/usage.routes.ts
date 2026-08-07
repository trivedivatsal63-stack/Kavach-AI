import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as usageController from "../controllers/usage.controller";

export const usageRouter = Router();

usageRouter.get("/", requireAuth, usageController.list);

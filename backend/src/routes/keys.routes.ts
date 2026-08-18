import { Router } from "express";
import { requireAuth, requireActiveAccount } from "../middleware/auth";
import * as keysController from "../controllers/keys.controller";

export const keysRouter = Router();

keysRouter.post("/test", requireAuth, requireActiveAccount, keysController.test);
keysRouter.post("/", requireAuth, requireActiveAccount, keysController.create);
keysRouter.get("/", requireAuth, keysController.list);
keysRouter.delete("/:id", requireAuth, keysController.revoke);

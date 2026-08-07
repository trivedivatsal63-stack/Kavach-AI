import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as keysController from "../controllers/keys.controller";

export const keysRouter = Router();

keysRouter.post("/test", requireAuth, keysController.test);
keysRouter.post("/", requireAuth, keysController.create);
keysRouter.get("/", requireAuth, keysController.list);
keysRouter.delete("/:id", requireAuth, keysController.revoke);

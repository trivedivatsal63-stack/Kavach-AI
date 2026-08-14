import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as conversationsController from "../controllers/conversations.controller";

export const conversationsRouter = Router();

conversationsRouter.use(requireAuth);
conversationsRouter.post("/", conversationsController.create);
conversationsRouter.get("/", conversationsController.list);
conversationsRouter.get("/:id", conversationsController.get);
conversationsRouter.delete("/:id", conversationsController.remove);
conversationsRouter.post("/:id/messages", conversationsController.sendMessage);

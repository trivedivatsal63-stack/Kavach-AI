import { Router } from "express";
import { requireAuth, requireActiveAccount } from "../middleware/auth";
import * as conversationsController from "../controllers/conversations.controller";

export const conversationsRouter = Router();

conversationsRouter.use(requireAuth);
conversationsRouter.post("/", requireActiveAccount, conversationsController.create);
conversationsRouter.get("/", conversationsController.list);
conversationsRouter.get("/:id", conversationsController.get);
conversationsRouter.delete("/:id", requireActiveAccount, conversationsController.remove);
conversationsRouter.post(
  "/:id/messages",
  requireActiveAccount,
  conversationsController.sendMessage
);
conversationsRouter.post(
  "/:id/messages/stream",
  requireActiveAccount,
  conversationsController.sendMessageStream
);

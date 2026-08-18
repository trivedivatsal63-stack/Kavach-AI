import { Router } from "express";
import { requireAuth, requireSuperadmin } from "../middleware/auth";
import * as adminController from "../controllers/admin.controller";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireSuperadmin);

adminRouter.get("/users", adminController.listUsers);
adminRouter.get("/users/:id", adminController.getUser);
adminRouter.post("/users/:id/pause", adminController.pauseUser);
adminRouter.post("/users/:id/unpause", adminController.unpauseUser);
adminRouter.post("/users/:id/block", adminController.blockUser);
adminRouter.post("/users/:id/unblock", adminController.unblockUser);
adminRouter.post("/users/:id/delete", adminController.deleteUser);
adminRouter.post("/users/:id/restore", adminController.restoreUser);
adminRouter.post("/users/:id/keys/revoke-all", adminController.revokeAllKeys);
adminRouter.post("/users/:id/keys/:keyId/revoke", adminController.revokeKey);

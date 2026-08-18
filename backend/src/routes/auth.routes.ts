import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as authController from "../controllers/auth.controller";

export const authRouter = Router();

authRouter.post("/signup", authController.signup);
authRouter.post("/login", authController.login);
authRouter.get("/me", requireAuth, authController.me);

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as authController from "../controllers/auth.controller";

export const authRouter = Router();

authRouter.post("/signup", authController.signup);
authRouter.post("/login", authController.login);
authRouter.post("/verify-otp", authController.verifyOtp);
authRouter.post("/resend-otp", authController.resendOtp);
authRouter.post("/forgot-password", authController.forgotPassword);
authRouter.post("/reset-password", authController.resetPassword);
authRouter.get("/me", requireAuth, authController.me);

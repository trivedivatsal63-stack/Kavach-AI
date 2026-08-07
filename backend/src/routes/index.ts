import { Router } from "express";
import { authRouter } from "./auth.routes";
import { keysRouter } from "./keys.routes";
import { creditsRouter } from "./credits.routes";
import { usageRouter } from "./usage.routes";
import { ragRouter } from "./rag.routes";

export function registerRoutes(app: Router) {
  app.use("/auth", authRouter);
  app.use("/keys", keysRouter);
  app.use("/credits", creditsRouter);
  app.use("/usage", usageRouter);
  app.use(ragRouter);
}

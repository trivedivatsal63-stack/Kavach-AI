import { Router } from "express";
import { authRouter } from "./auth.routes";
import { keysRouter } from "./keys.routes";
import { creditsRouter } from "./credits.routes";
import { usageRouter } from "./usage.routes";
import { ragRouter } from "./rag.routes";
import { conversationsRouter } from "./conversations.routes";
import { completionsRouter } from "./completions.routes";
import { adminRouter } from "./admin.routes";
import { complianceRouter } from "./compliance.routes";

export function registerRoutes(app: Router) {
  app.use("/auth", authRouter);
  app.use("/keys", keysRouter);
  app.use("/credits", creditsRouter);
  app.use("/usage", usageRouter);
  app.use("/conversations", conversationsRouter);
  app.use("/admin", adminRouter);
  app.use(ragRouter);
  app.use(completionsRouter);
  app.use(complianceRouter);
}

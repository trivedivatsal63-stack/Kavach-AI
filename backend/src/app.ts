import express from "express";
import cors from "cors";
import { env } from "./config";
import { registerRoutes } from "./routes";
import { errorHandler, notFound } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  registerRoutes(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

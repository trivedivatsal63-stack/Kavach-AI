import { Router } from "express";
import { ensureSchema } from "./db";
import { markInterruptedAsFailed } from "./services/documents";
import { ensureCollection } from "./services/qdrant";
import { documentsRouter } from "./routes/documents";
import { keysRouter } from "./routes/keys";
import { chatRouter } from "./routes/chat";
import { publicRouter } from "./routes/public";

// Module entry point. Runs idempotent setup at load (tables, interrupted-job
// recovery, vector collection) and exports a single router mounted in
// backend/src/index.ts as `app.use(ragRouter)`. Nothing in the existing app
// is modified — this is purely additive.
void (async () => {
  try {
    await ensureSchema();
    await markInterruptedAsFailed();
    // Qdrant may still be starting; routes retry ensureCollection lazily, so
    // a failure here is logged but not fatal.
    await ensureCollection().catch((err) =>
      console.error("[rag] Qdrant not ready at startup:", err)
    );
    console.log("[rag] schema + vector collection ready");
  } catch (err) {
    console.error("[rag] startup setup failed:", err);
  }
})();

export const ragRouter = Router();
ragRouter.use("/rag/documents", documentsRouter);
ragRouter.use("/rag/keys", keysRouter);
ragRouter.use("/rag/chat", chatRouter);
ragRouter.use(publicRouter); // defines /v1/rag/query

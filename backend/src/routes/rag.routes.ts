import express, { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as documentsController from "../controllers/rag/documents.controller";
import * as keysController from "../controllers/rag/keys.controller";
import * as chatController from "../controllers/rag/chat.controller";
import * as queryController from "../controllers/rag/query.controller";
import { MAX_UPLOAD_BYTES } from "../utils/rag.constants";

export const ragRouter = Router();

const documentsRouter = Router();
documentsRouter.use(requireAuth);
documentsRouter.post(
  "/",
  express.raw({
    type: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/markdown",
      "application/octet-stream",
    ],
    limit: `${MAX_UPLOAD_BYTES + 1024 * 1024}`,
  }),
  documentsController.upload
);
documentsRouter.get("/", documentsController.list);
documentsRouter.get("/:id/chunks", documentsController.listChunks);
documentsRouter.delete("/:id", documentsController.remove);

const keysRouter = Router();
keysRouter.use(requireAuth);
keysRouter.post("/", keysController.create);
keysRouter.get("/", keysController.list);
keysRouter.delete("/:id", keysController.revoke);

const chatRouter = Router();
chatRouter.use(requireAuth);
chatRouter.post("/", chatController.chat);

ragRouter.use("/rag/documents", documentsRouter);
ragRouter.use("/rag/keys", keysRouter);
ragRouter.use("/rag/chat", chatRouter);
ragRouter.post("/v1/rag/query", queryController.query);

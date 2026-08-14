import { Router } from "express";
import * as completionsController from "../controllers/completions.controller";

// No requireAuth here — deliberately, same as /v1/rag/query: this is a
// public API authenticated via the caller's own bearer key (checked and
// forwarded to LiteLLM inside the controller), not a dashboard JWT session.
export const completionsRouter = Router();
completionsRouter.post("/v1/chat/completions", completionsController.completions);

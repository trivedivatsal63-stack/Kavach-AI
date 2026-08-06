import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { keysRouter } from "./routes/keys";
import { usageRouter } from "./routes/usage";
import { creditsRouter } from "./routes/credits";
import { ragRouter } from "./dynamic-rag-functionality/2026-08-06";

const app = express();
const PORT = process.env.PORT ?? 4001;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Dependency-free — only confirms the server itself is up.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/keys", keysRouter);
app.use("/usage", usageRouter);
app.use("/credits", creditsRouter);

// RAG module (dynamic-rag-functionality/2026-08-06) — mounts its own
// /rag/* routes and the public /v1/rag/query endpoint.
app.use(ragRouter);

app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});

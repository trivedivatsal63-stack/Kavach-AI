import express, { Router } from "express";
import { requireAuth } from "../../../auth";
import { enqueueIngestion } from "../queue";
import { createDocument, listDocuments } from "../services/documents";
import { deleteDocument } from "../services/retrieval";
import { config } from "../config";
import { ALLOWED_UPLOAD_MIMES, MAX_UPLOAD_BYTES } from "../constants";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

// Upload accepts the raw file bytes (no multipart) with the filename in the
// x-filename header. express.raw only parses the listed content types, so a
// disallowed type arrives as an empty body and is rejected below.
documentsRouter.post(
  "/",
  express.raw({
    type: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/markdown",
      "application/octet-stream",
    ],
    limit: `${MAX_UPLOAD_BYTES + 1024 * 1024}`,
  }),
  async (req, res) => {
    const userId = req.userId!;

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "File body is required." });
      return;
    }
    if (req.body.length > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: "File exceeds the 25 MB upload limit." });
      return;
    }

    const rawName =
      typeof req.headers["x-filename"] === "string"
        ? safeDecode(req.headers["x-filename"])
        : "document";
    const name = sanitizeFilename(rawName);

    let mimeType = String(req.headers["content-type"] ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (mimeType === "application/octet-stream" || mimeType === "") {
      mimeType = guessMimeFromName(name);
    }

    if (!ALLOWED_UPLOAD_MIMES.includes(mimeType as (typeof ALLOWED_UPLOAD_MIMES)[number])) {
      res.status(400).json({
        error:
          "Unsupported file type. Allowed: PDF, DOCX, TXT, Markdown.",
      });
      return;
    }

    try {
      const document = await createDocument({
        userId,
        name,
        mimeType,
        sizeBytes: req.body.length,
        embeddingModel: config.embeddingModel,
      });

      enqueueIngestion({
        userId,
        documentId: document.id,
        name,
        mimeType,
        buffer: req.body,
      });

      res.status(202).json({ document });
    } catch (err) {
      console.error("POST /rag/documents failed:", err);
      res.status(500).json({ error: "Failed to enqueue document." });
    }
  }
);

documentsRouter.get("/", async (req, res) => {
  try {
    const documents = await listDocuments(req.userId!);
    res.json({ documents });
  } catch (err) {
    console.error("GET /rag/documents failed:", err);
    res.status(500).json({ error: "Failed to list documents." });
  }
});

documentsRouter.delete("/:id", async (req, res) => {
  try {
    const deleted = await deleteDocument(req.userId!, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.json({ id: deleted.id });
  } catch (err) {
    console.error("DELETE /rag/documents/:id failed:", err);
    res.status(500).json({ error: "Failed to delete document." });
  }
});

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "document";
  const cleaned = base.replace(/[^\w.\-() ]+/g, "_").trim();
  return (cleaned || "document").slice(0, 200);
}

function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

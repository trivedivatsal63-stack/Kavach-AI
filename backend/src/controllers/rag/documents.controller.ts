import type { Request, Response, NextFunction } from "express";
import { enqueueIngestion } from "../../jobs/ingestion.queue";
import {
  createDocument,
  getDocument,
  listChunksForDocument,
  listDocuments,
} from "../../services/rag/documents.service";
import { deleteDocument } from "../../services/rag/retrieval.service";
import { ragConfig } from "../../config/rag";
import {
  ALLOWED_UPLOAD_MIMES,
  MAX_UPLOAD_BYTES,
} from "../../utils/rag.constants";
import { AppError } from "../../middleware/errorHandler";

export async function upload(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(400, "File body is required.");
    }
    if (req.body.length > MAX_UPLOAD_BYTES) {
      throw new AppError(413, "File exceeds the 25 MB upload limit.");
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

    if (
      !ALLOWED_UPLOAD_MIMES.includes(
        mimeType as (typeof ALLOWED_UPLOAD_MIMES)[number]
      )
    ) {
      throw new AppError(
        400,
        "Unsupported file type. Allowed: PDF, DOCX, XLSX, TXT, Markdown."
      );
    }

    const document = await createDocument({
      userId,
      name,
      mimeType,
      sizeBytes: req.body.length,
      embeddingModel: ragConfig.embeddingModel,
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
    if (!(err instanceof AppError)) {
      console.error("POST /rag/documents failed:", err);
      next(new AppError(500, "Failed to enqueue document."));
      return;
    }
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ documents: await listDocuments(req.userId!) });
  } catch (err) {
    console.error("GET /rag/documents failed:", err);
    next(new AppError(500, "Failed to list documents."));
  }
}

export async function listChunks(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await getDocument(req.userId!, String(req.params.id));
    if (!doc) {
      throw new AppError(404, "Document not found.");
    }
    res.json({ chunks: await listChunksForDocument(req.userId!, doc.id) });
  } catch (err) {
    if (!(err instanceof AppError)) {
      console.error("GET /rag/documents/:id/chunks failed:", err);
      next(new AppError(500, "Failed to list chunks."));
      return;
    }
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const deleted = await deleteDocument(req.userId!, String(req.params.id));
    if (!deleted) {
      throw new AppError(404, "Document not found.");
    }
    res.json({ id: deleted.id });
  } catch (err) {
    if (!(err instanceof AppError)) {
      console.error("DELETE /rag/documents/:id failed:", err);
      next(new AppError(500, "Failed to delete document."));
      return;
    }
    next(err);
  }
}

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
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

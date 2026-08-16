import type { Request, Response, NextFunction } from "express";
import { prisma } from "../models/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  CONVERSATION_MODE,
  MAX_MESSAGE_CHARS,
  type ConversationMode,
} from "../utils/chat.constants";
import {
  appendMessages,
  createConversation,
  deleteConversation,
  getConversationMeta,
  getConversationWithMessages,
  listConversations,
  listRecentMessages,
  touchConversation,
} from "../services/conversations.service";
import { resolveChatKey } from "../services/rag/chatKeys.service";
import { answerQuestion } from "../services/rag/chat.service";
import { answerChatMessage } from "../services/chat.service";
import {
  CompletionError,
  mapCompletionErrorStatus,
} from "../services/rag/completion.service";
import { filterOwnedDocumentIds } from "./rag/chat.controller";

function isValidMode(value: unknown): value is ConversationMode {
  return value === CONVERSATION_MODE.CHAT || value === CONVERSATION_MODE.RAG;
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const mode = req.body?.mode;
    if (!isValidMode(mode)) {
      throw new AppError(400, "mode must be \"chat\" or \"rag\".");
    }

    let documentIds: string[] | undefined;
    if (mode === CONVERSATION_MODE.RAG) {
      const providedIds: string[] = Array.isArray(req.body?.documentIds)
        ? req.body.documentIds.filter(
            (id: unknown): id is string => typeof id === "string"
          )
        : [];
      documentIds = await filterOwnedDocumentIds(userId, providedIds);
    }

    const conversation = await createConversation(userId, mode, documentIds);
    res.status(201).json({ conversation });
  } catch (err) {
    if (!(err instanceof AppError)) {
      console.error("POST /conversations failed:", err);
      next(new AppError(500, "Failed to create conversation."));
      return;
    }
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const mode = req.query.mode;
    if (!isValidMode(mode)) {
      throw new AppError(400, "mode query param must be \"chat\" or \"rag\".");
    }
    const conversations = await listConversations(req.userId!, mode);
    res.json({ conversations });
  } catch (err) {
    if (!(err instanceof AppError)) {
      console.error("GET /conversations failed:", err);
      next(new AppError(500, "Failed to list conversations."));
      return;
    }
    next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const conversation = await getConversationWithMessages(
      req.userId!,
      String(req.params.id)
    );
    if (!conversation) {
      throw new AppError(404, "Conversation not found.");
    }
    res.json({ conversation });
  } catch (err) {
    if (!(err instanceof AppError)) {
      console.error("GET /conversations/:id failed:", err);
      next(new AppError(500, "Failed to load conversation."));
      return;
    }
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const deleted = await deleteConversation(req.userId!, String(req.params.id));
    if (!deleted) {
      throw new AppError(404, "Conversation not found.");
    }
    res.json({ id: req.params.id });
  } catch (err) {
    if (!(err instanceof AppError)) {
      console.error("DELETE /conversations/:id failed:", err);
      next(new AppError(500, "Failed to delete conversation."));
      return;
    }
    next(err);
  }
}

export async function sendMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const conversationId = String(req.params.id);
    const content = String(req.body?.content ?? "").trim();

    if (!content) {
      throw new AppError(400, "Message content is required.");
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new AppError(400, "Message is too long.");
    }

    const conversation = await getConversationMeta(userId, conversationId);
    if (!conversation) {
      throw new AppError(404, "Conversation not found.");
    }

    const priorMessages = await listRecentMessages(conversationId);
    const history = priorMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const balance = user.creditBalanceUsd.toNumber();
    const { rawKey } = await resolveChatKey(userId, balance);

    // Explicit per-message opt-in only — a toggle the user flips in the
    // composer, never inferred. See services/liveSearch/ for why.
    const webSearch = req.body?.webSearch === true;

    let assistantContent: string;
    let citations: unknown = undefined;
    let webCitations: unknown = undefined;
    let usage: { promptTokens: number; completionTokens: number } | null = null;

    if (conversation.mode === CONVERSATION_MODE.RAG) {
      const documentIds = Array.isArray(conversation.documentIds)
        ? (conversation.documentIds as string[])
        : undefined;
      const result = await answerQuestion({
        userId,
        question: content,
        apiKey: rawKey,
        documentIds,
        history,
        webSearch,
      });
      assistantContent = result.answer;
      citations = result.citations;
      webCitations = result.webCitations;
      usage = result.usage;
    } else {
      const result = await answerChatMessage({
        apiKey: rawKey,
        question: content,
        history,
        webSearch,
      });
      assistantContent = result.answer;
      webCitations = result.webCitations;
      usage = result.usage;
    }

    const { userMessage, assistantMessage } = await appendMessages(
      conversationId,
      { content },
      {
        content: assistantContent,
        citations,
        webCitations,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
      }
    );
    await touchConversation(conversationId, content);

    const updated = await getConversationMeta(userId, conversationId);
    res.json({ userMessage, assistantMessage, conversation: updated });
  } catch (err) {
    if (err instanceof CompletionError) {
      next(new AppError(mapCompletionErrorStatus(err.status), err.message));
      return;
    }
    if (!(err instanceof AppError)) {
      console.error("POST /conversations/:id/messages failed:", err);
      next(new AppError(500, "Failed to send message."));
      return;
    }
    next(err);
  }
}

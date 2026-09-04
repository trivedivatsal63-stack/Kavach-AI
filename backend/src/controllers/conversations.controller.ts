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
  StreamAborted,
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

// Shared preparation for sendMessage + sendMessageStream: validates input,
// loads history, resolves the spend-attributed chat key, and normalizes the
// web-search tri-state. Throws AppError on any client error.
async function prepareSend(userId: string, conversationId: string, body: unknown) {
  const content = String((body as Record<string, unknown>)?.content ?? "").trim();

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

  // Tri-state: true = forced search (composer toggle on), false = never,
  // 'auto'/undefined = model decides + rewrites the query (default on
  // conversational paths so follow-ups like "what about renewal terms?"
  // resolve against history). See searchDecision.service.ts.
  const rawWeb = (body as Record<string, unknown>)?.webSearch;
  const webSearch: boolean | "auto" =
    rawWeb === true ? true : rawWeb === false ? false : "auto";

  return { conversation, history, rawKey, webSearch, content };
}

export async function sendMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const conversationId = String(req.params.id);
    const { conversation, history, rawKey, webSearch, content } = await prepareSend(
      userId,
      conversationId,
      req.body
    );

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
        agentic: true,
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
        agentic: true,
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

// Streaming variant of sendMessage: same pipeline, same persistence, but
// the UI gets a Claude-style status timeline plus live token deltas over
// SSE. Events:
//   status {phase} — routing/searching/retrieving/generating, in real order
//   token  {delta} — completion text chunks once generating starts
//   done   {userMessage, assistantMessage, conversation, stopped?} — persisted rows
//   error  {message, status} — terminal failure (nothing persisted)
// Stop (client disconnect) aborts the LiteLLM fetch and persists whatever
// had streamed so far as the assistant message (keep-partial). The
// non-stream route stays as the fallback.
export async function sendMessageStream(req: Request, res: Response) {
  const userId = req.userId!;
  const conversationId = String(req.params.id);

  let prep: Awaited<ReturnType<typeof prepareSend>>;
  try {
    prep = await prepareSend(userId, conversationId, req.body);
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    const message = err instanceof AppError ? err.message : "Failed to send message.";
    res.status(status).json({ error: message });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Client disconnect (Stop button) aborts the downstream LiteLLM stream.
  // completeChatStream translates the abort into StreamAborted below.
  const aborter = new AbortController();
  req.on("close", () => {
    if (!res.writableEnded) aborter.abort();
  });

  // Persists one assistant turn (full or partial) and emits done.
  const finish = async (
    content: string,
    assistantContent: string,
    citations: unknown,
    webCitations: unknown,
    usage: { promptTokens: number; completionTokens: number } | null,
    stopped: boolean
  ) => {
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
    send("done", { userMessage, assistantMessage, conversation: updated, stopped });
  };

  try {
    const { conversation, history, rawKey, webSearch, content } = prep;
    const onPhase = (phase: string) => send("status", { phase });

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
        onPhase,
        onToken: (delta) => send("token", { delta }),
        signal: aborter.signal,
        agentic: true,
      });
      await finish(content, result.answer, result.citations, result.webCitations, result.usage, false);
    } else {
      const result = await answerChatMessage({
        apiKey: rawKey,
        question: content,
        history,
        webSearch,
        onPhase,
        onToken: (delta) => send("token", { delta }),
        signal: aborter.signal,
        agentic: true,
      });
      await finish(content, result.answer, undefined, result.webCitations, result.usage, false);
    }
  } catch (err) {
    if (err instanceof StreamAborted) {
      // Stop pressed: keep whatever streamed. Retrieval/search citations
      // are unavailable here (the abort happened mid-generation), so the
      // partial persists text-only — the same tradeoff ChatGPT makes.
      const partial =
        err.partialText.trim() || "(Response stopped before any output.)";
      try {
        await finish(prep.content, partial, undefined, undefined, null, true);
      } catch (persistErr) {
        console.error("POST /conversations/:id/messages/stream persist-partial failed:", persistErr);
      }
    } else if (err instanceof CompletionError) {
      send("error", { message: err.message, status: mapCompletionErrorStatus(err.status) });
    } else {
      console.error("POST /conversations/:id/messages/stream failed:", err);
      const message = err instanceof AppError ? err.message : "Failed to send message.";
      const status = err instanceof AppError ? err.status : 500;
      send("error", { message, status });
    }
  } finally {
    res.end();
  }
}

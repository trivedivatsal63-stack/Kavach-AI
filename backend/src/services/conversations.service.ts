import type { Conversation, Message } from "@prisma/client";
import { prisma } from "../models/prisma";
import type { ConversationMode, MessageRole } from "../utils/chat.constants";
import { MAX_HISTORY_MESSAGES } from "../utils/chat.constants";

const DEFAULT_TITLE = "New chat";

// CRUD for the shared chat/RAG conversation system. All queries filter on
// userId so a user can only ever see their own conversations — same
// isolation discipline as every other user-scoped service in this codebase.

export async function listConversations(
  userId: string,
  mode: ConversationMode
): Promise<Conversation[]> {
  return prisma.conversation.findMany({
    where: { userId, mode },
    orderBy: { updatedAt: "desc" },
  });
}

export async function createConversation(
  userId: string,
  mode: ConversationMode,
  documentIds?: string[] | null
): Promise<Conversation> {
  return prisma.conversation.create({
    data: {
      userId,
      mode,
      documentIds: documentIds && documentIds.length > 0 ? documentIds : undefined,
    },
  });
}

export async function getConversationMeta(
  userId: string,
  id: string
): Promise<Conversation | null> {
  return prisma.conversation.findFirst({ where: { id, userId } });
}

export async function getConversationWithMessages(
  userId: string,
  id: string
): Promise<(Conversation & { messages: Message[] }) | null> {
  return prisma.conversation.findFirst({
    where: { id, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

// Most recent messages for building the next turn's history — bounded so a
// very long conversation doesn't pull an unbounded row set (the actual
// token-budget fitting happens downstream via trimHistoryToTokenBudget).
export async function listRecentMessages(
  conversationId: string
): Promise<Message[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY_MESSAGES,
  });
  return rows.reverse();
}

export async function deleteConversation(
  userId: string,
  id: string
): Promise<boolean> {
  const result = await prisma.conversation.deleteMany({ where: { id, userId } });
  return result.count > 0;
}

export async function appendMessages(
  conversationId: string,
  userMessage: { content: string },
  assistantMessage: {
    content: string;
    citations?: unknown;
    webCitations?: unknown;
    promptTokens?: number;
    completionTokens?: number;
  }
): Promise<{ userMessage: Message; assistantMessage: Message }> {
  const [savedUser, savedAssistant] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        role: "user" satisfies MessageRole,
        content: userMessage.content,
      },
    }),
    prisma.message.create({
      data: {
        conversationId,
        role: "assistant" satisfies MessageRole,
        content: assistantMessage.content,
        citations: assistantMessage.citations ?? undefined,
        webCitations: assistantMessage.webCitations ?? undefined,
        promptTokens: assistantMessage.promptTokens,
        completionTokens: assistantMessage.completionTokens,
      },
    }),
  ]);
  return { userMessage: savedUser, assistantMessage: savedAssistant };
}

// Bumps updatedAt (so the conversation resorts to the top of the sidebar)
// and, only if the title is still the default, sets it from the first
// user message — truncated, no extra LLM call spent purely on titling.
export async function touchConversation(
  id: string,
  firstMessageContent: string
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: { title: true },
  });
  if (!conversation) return;

  await prisma.conversation.update({
    where: { id },
    data:
      conversation.title === DEFAULT_TITLE
        ? { title: truncateTitle(firstMessageContent) }
        : {},
  });
}

function truncateTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_TITLE;
  return trimmed.length > 48 ? `${trimmed.slice(0, 48).trimEnd()}…` : trimmed;
}

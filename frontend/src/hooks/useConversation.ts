import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createConversation,
  deleteConversation as apiDeleteConversation,
  getConversation,
  listConversations,
  sendConversationMessage,
  type ConversationMode,
  type ConversationSummary,
} from "../lib/api";
import type { UIMessage } from "../components/chat/MessageThread";
import { useAuth } from "../context/AuthContext";

// Shared by ChatPage (mode="chat") and RagPage (mode="rag"). First-message
// creation is folded into sendMessage so the UI can flip to the thread and
// show "Generating…" immediately — before any network round-trip.
export function useConversation(token: string | null, mode: ConversationMode) {
  const { user, updateUser } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!token) return;
    const { conversations } = await listConversations(token, mode);
    setConversations(conversations);
  }, [token, mode]);

  useEffect(() => {
    refreshList().catch(() => {});
  }, [refreshList]);

  const selectConversation = useCallback(
    async (id: string) => {
      if (!token) return;
      setActiveId(id);
      setLoadingMessages(true);
      setError(null);
      try {
        const { conversation } = await getConversation(token, id);
        setMessages(conversation.messages);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Failed to load conversation."
        );
      } finally {
        setLoadingMessages(false);
      }
    },
    [token]
  );

  // Local-only reset — clears the active conversation so the shell shows an
  // empty "new chat" state, without creating a backend row yet.
  const startComposing = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setError(null);
  }, []);

  const startNewConversation = useCallback(
    async (documentIds?: string[]) => {
      if (!token) return;
      const { conversation } = await createConversation(token, mode, documentIds);
      setConversations((prev) => [conversation, ...prev]);
      setActiveId(conversation.id);
      setMessages([]);
      setError(null);
      return conversation;
    },
    [token, mode]
  );

  const removeConversation = useCallback(
    async (id: string) => {
      if (!token) return;
      await apiDeleteConversation(token, id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    },
    [token, activeId]
  );

  const sendMessage = useCallback(
    // targetId: pass an id when the caller already created a conversation.
    // documentIds: used only when lazily creating on the first RAG message.
    async (
      content: string,
      targetId?: string,
      webSearch?: boolean,
      documentIds?: string[]
    ) => {
      if (!token || sending) return;

      const optimisticId = crypto.randomUUID();
      setError(null);
      setMessages((m) => [...m, { id: optimisticId, role: "user", content }]);
      setSending(true);
      const startedAt = performance.now();

      let conversationId = targetId ?? activeId;

      try {
        if (!conversationId) {
          const { conversation } = await createConversation(
            token,
            mode,
            documentIds
          );
          setConversations((prev) => [conversation, ...prev]);
          setActiveId(conversation.id);
          conversationId = conversation.id;
        }

        const result = await sendConversationMessage(
          token,
          conversationId,
          content,
          webSearch
        );
        const latencyMs = Math.round(performance.now() - startedAt);
        const billing = result.billing;
        setMessages((m) => [
          ...m.filter((msg) => msg.id !== optimisticId),
          result.userMessage,
          {
            ...result.assistantMessage,
            latencyMs,
            costUsd: billing?.costUsd,
            promptTokens: billing?.promptTokens,
            completionTokens: billing?.completionTokens,
          },
        ]);
        setConversations((prev) =>
          prev
            .map((c) => (c.id === conversationId ? result.conversation : c))
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        );
        if (billing && user) {
          updateUser({ ...user, creditBalanceUsd: billing.remainingUsd });
        }
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : "Failed to send message.";
        setError(message);
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: message,
            error: true,
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [token, activeId, sending, mode, user, updateUser]
  );

  return {
    conversations,
    activeId,
    messages,
    loadingMessages,
    sending,
    error,
    selectConversation,
    startComposing,
    startNewConversation,
    deleteConversation: removeConversation,
    sendMessage,
  };
}

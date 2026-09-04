import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createConversation,
  deleteConversation as apiDeleteConversation,
  getConversation,
  listConversations,
  sendConversationMessage,
  sendConversationMessageStream,
  type ConversationMode,
  type ConversationSummary,
  type StreamPhase,
} from "../lib/api";
import type { UIMessage } from "../components/chat/MessageThread";

// The de-duplication point for the chat-app shell — used by both ChatPage
// (mode="chat") and RagPage (mode="rag") so conversation list/thread/send
// logic isn't written twice. RAG-specific bits (document scope) are passed
// through startNewConversation's documentIds param; everything else is
// mode-agnostic.
export function useConversation(token: string | null, mode: ConversationMode) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live SSE pipeline phases for the AgentStatus timeline. Non-empty only
  // while a streamed request is in flight; cleared on completion.
  const [streamPhases, setStreamPhases] = useState<StreamPhase[]>([]);
  // Live completion text while tokens stream. Cleared when the persisted
  // message arrives (replaced by it) or the request settles.
  const [streamingText, setStreamingText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const streamingConvRef = useRef<string | null>(null);

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
  // empty "new chat" state, without creating a backend row yet. Actual
  // creation happens lazily on the first sent message (see sendMessage),
  // so clicking "+ New chat" and never typing anything doesn't litter the
  // sidebar with empty conversations. RAG Studio uses this same reset to
  // show its document-scope picker before a conversation exists.
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
    // targetId lets a caller that JUST created a conversation (via
    // startNewConversation, an async state update) pass its id explicitly
    // instead of relying on `activeId` from this closure — immediately
    // after setActiveId(), activeId here can still be stale until the next
    // render, which would otherwise make this silently no-op.
    async (content: string, targetId?: string, webSearch?: boolean) => {
      const conversationId = targetId ?? activeId;
      if (!token || !conversationId || sending) return;
      setError(null);
      const optimisticId = crypto.randomUUID();
      setMessages((m) => [
        ...m,
        { id: optimisticId, role: "user", content },
      ]);
      setSending(true);
      try {
        const result = await sendConversationMessage(
          token,
          conversationId,
          content,
          webSearch
        );
        setMessages((m) => [
          ...m.filter((msg) => msg.id !== optimisticId),
          result.userMessage,
          result.assistantMessage,
        ]);
        setConversations((prev) =>
          prev
            .map((c) => (c.id === conversationId ? result.conversation : c))
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        );
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              err instanceof ApiError ? err.message : "Failed to send message.",
            error: true,
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [token, activeId, sending]
  );

  // Streaming variant: same persistence contract as sendMessage, plus a
  // live AgentStatus timeline fed by SSE `status` events and a live text
  // bubble fed by `token` deltas. Falls back to the classic non-stream path
  // if the stream endpoint is unavailable (e.g. backend predates it) —
  // never leaves the user with no way to send.
  const sendMessageStream = useCallback(
    async (content: string, targetId?: string, webSearch?: boolean) => {
      const conversationId = targetId ?? activeId;
      if (!token || !conversationId || sending) return;
      setError(null);
      const optimisticId = crypto.randomUUID();
      setMessages((m) => [
        ...m,
        { id: optimisticId, role: "user", content },
      ]);
      setSending(true);
      setStreamPhases([]);
      setStreamingText("");
      const aborter = new AbortController();
      abortRef.current = aborter;
      streamingConvRef.current = conversationId;
      const pushErrorBubble = (message: string) =>
        setMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: "assistant", content: message, error: true },
        ]);
      try {
        const result = await sendConversationMessageStream(
          token,
          conversationId,
          content,
          webSearch,
          {
            onPhase: (phase) =>
              setStreamPhases((prev) => (prev.includes(phase) ? prev : [...prev, phase])),
            onToken: (delta) => setStreamingText((prev) => prev + delta),
          },
          aborter.signal
        );
        setMessages((m) => [
          ...m.filter((msg) => msg.id !== optimisticId),
          result.userMessage,
          result.assistantMessage,
        ]);
        setConversations((prev) =>
          prev
            .map((c) => (c.id === conversationId ? result.conversation : c))
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        );
      } catch (err) {
        if (aborter.signal.aborted) {
          // Intentional Stop: the server persisted the partial on
          // disconnect. Reload to pick it up (replaces the optimistic
          // message and any streamed text with the persisted rows).
          setStreamPhases([]);
          setStreamingText("");
          try {
            await new Promise((r) => setTimeout(r, 600));
            const { conversation } = await getConversation(token, conversationId);
            setMessages(conversation.messages);
          } catch {
            pushErrorBubble("Stopped. Reload the conversation to see the partial reply.");
          }
        } else if (err instanceof ApiError && err.status === 404) {
          // Stream endpoint missing — retry classically with the optimistic
          // message already in place.
          setStreamPhases([]);
          try {
            const result = await sendConversationMessage(
              token,
              conversationId,
              content,
              webSearch
            );
            setMessages((m) => [
              ...m.filter((msg) => msg.id !== optimisticId),
              result.userMessage,
              result.assistantMessage,
            ]);
            setConversations((prev) =>
              prev
                .map((c) => (c.id === conversationId ? result.conversation : c))
                .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
            );
            return;
          } catch (fallbackErr) {
            pushErrorBubble(
              fallbackErr instanceof ApiError ? fallbackErr.message : "Failed to send message."
            );
          }
        } else {
          pushErrorBubble(
            err instanceof ApiError ? err.message : "Failed to send message."
          );
        }
      } finally {
        setSending(false);
        setStreamPhases([]);
        setStreamingText("");
        if (abortRef.current === aborter) abortRef.current = null;
        streamingConvRef.current = null;
      }
    },
    [token, activeId, sending]
  );

  // Stop button: aborts the in-flight SSE request. The backend persists
  // the partial reply; the abort branch above reloads it into view.
  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    conversations,
    activeId,
    messages,
    loadingMessages,
    sending,
    streamPhases,
    streamingText,
    stopStreaming,
    error,
    selectConversation,
    startComposing,
    startNewConversation,
    deleteConversation: removeConversation,
    sendMessage,
    sendMessageStream,
  };
}

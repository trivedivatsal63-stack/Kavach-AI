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
  // Guards against out-of-order async completion scrambling threads:
  // - activeIdRef: message-list mutations from a send only apply while its
  //   conversation is still the visible one (switching mid-flight no longer
  //   grafts one conversation's turns onto another's thread).
  // - loadSeqRef: only the latest selectConversation load may set messages.
  const activeIdRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);

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
      // Leaving a conversation aborts its in-flight stream (the server
      // persists the partial; it will be there when the user returns) and
      // clears live state so no other thread inherits this one's timeline.
      abortRef.current?.abort();
      abortRef.current = null;
      streamingConvRef.current = null;
      setStreamPhases([]);
      setStreamingText("");
      setSending(false);
      const seq = ++loadSeqRef.current;
      activeIdRef.current = id;
      setActiveId(id);
      setLoadingMessages(true);
      setError(null);
      try {
        const { conversation } = await getConversation(token, id);
        if (loadSeqRef.current !== seq || activeIdRef.current !== id) return;
        setMessages(conversation.messages);
      } catch (err) {
        if (loadSeqRef.current !== seq || activeIdRef.current !== id) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load conversation."
        );
      } finally {
        if (loadSeqRef.current === seq && activeIdRef.current === id) {
          setLoadingMessages(false);
        }
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
    abortRef.current?.abort();
    abortRef.current = null;
    streamingConvRef.current = null;
    setStreamPhases([]);
    setStreamingText("");
    setSending(false);
    loadSeqRef.current++;
    activeIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setError(null);
  }, []);

  const startNewConversation = useCallback(
    async (documentIds?: string[]) => {
      if (!token) return;
      const { conversation } = await createConversation(token, mode, documentIds);
      setConversations((prev) => [conversation, ...prev]);
      loadSeqRef.current++;
      activeIdRef.current = conversation.id;
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
      // Message-list mutations below only apply while this conversation is
      // still visible; the sidebar list update is global and unguarded.
      const stillActive = () => activeIdRef.current === conversationId;
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
        if (!stillActive()) return;
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
        if (!stillActive()) return;
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
        if (stillActive()) setSending(false);
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
      // Same still-active guard as sendMessage: late SSE events, the done
      // payload, and the abort-reload must never mutate another
      // conversation's visible thread. Sidebar list updates stay global.
      const stillActive = () => activeIdRef.current === conversationId;
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
      const pushErrorBubble = (message: string) => {
        if (!stillActive()) return;
        setMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: "assistant", content: message, error: true },
        ]);
      };
      try {
        const result = await sendConversationMessageStream(
          token,
          conversationId,
          content,
          webSearch,
          {
            onPhase: (phase) => {
              if (!stillActive()) return;
              setStreamPhases((prev) => (prev.includes(phase) ? prev : [...prev, phase]));
            },
            onToken: (delta) => {
              if (!stillActive()) return;
              setStreamingText((prev) => prev + delta);
            },
          },
          aborter.signal
        );
        if (!stillActive()) return;
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
          // Stop (button or conversation switch): the server persisted the
          // partial on disconnect. Reload only if this conversation is
          // still the visible one — otherwise its thread is already correct
          // and will load the partial on next open.
          if (!stillActive()) return;
          setStreamPhases([]);
          setStreamingText("");
          try {
            await new Promise((r) => setTimeout(r, 600));
            if (!stillActive()) return;
            const { conversation } = await getConversation(token, conversationId);
            if (!stillActive()) return;
            setMessages(conversation.messages);
          } catch {
            pushErrorBubble("Stopped. Reload the conversation to see the partial reply.");
          }
        } else if (err instanceof ApiError && err.status === 404) {
          // Stream endpoint missing — retry classically with the optimistic
          // message already in place.
          if (!stillActive()) return;
          setStreamPhases([]);
          try {
            const result = await sendConversationMessage(
              token,
              conversationId,
              content,
              webSearch
            );
            if (!stillActive()) return;
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
        if (stillActive()) {
          setSending(false);
          setStreamPhases([]);
          setStreamingText("");
        }
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

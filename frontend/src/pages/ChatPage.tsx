import { useState } from "react";
import { Layout } from "../components/Layout";
import { ChatShell } from "../components/chat/ChatShell";
import { ConversationSidebar } from "../components/chat/ConversationSidebar";
import { MessageThread } from "../components/chat/MessageThread";
import { Composer } from "../components/chat/Composer";
import { useAuth } from "../context/AuthContext";
import { useConversation } from "../hooks/useConversation";

export function ChatPage() {
  const { token } = useAuth();
  const {
    conversations,
    activeId,
    messages,
    sending,
    error,
    selectConversation,
    startComposing,
    startNewConversation,
    deleteConversation,
    sendMessage,
  } = useConversation(token, "chat");

  const [draft, setDraft] = useState("");
  const [webSearch, setWebSearch] = useState(false);

  async function handleSend() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    if (!activeId) {
      const conversation = await startNewConversation();
      if (!conversation) return;
      await sendMessage(content, conversation.id, webSearch);
      return;
    }
    await sendMessage(content, undefined, webSearch);
  }

  return (
    <Layout fullHeight>
      <ChatShell
        sidebar={
          <ConversationSidebar
            conversations={conversations}
            activeId={activeId}
            onSelect={(id) => void selectConversation(id)}
            onNew={startComposing}
            onDelete={(id) => void deleteConversation(id)}
          />
        }
        main={
          <div className="card flex h-full min-h-0 flex-1 flex-col">
            {error && (
              <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
                {error}
              </p>
            )}
            <MessageThread
              messages={messages}
              sending={sending}
              emptyTitle="Start a conversation"
              emptyBody="Ask anything — this is a general-purpose chat against the model, no documents involved."
            />
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={() => void handleSend()}
              disabled={sending}
              placeholder="Message Kavach AI…"
              webSearch={webSearch}
              onToggleWebSearch={() => setWebSearch((v) => !v)}
            />
          </div>
        }
      />
    </Layout>
  );
}

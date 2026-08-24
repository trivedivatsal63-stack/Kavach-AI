import { useState } from "react";
import { AppShell } from "../components/appshell/AppShell";
import { AppSidebar } from "../components/appshell/AppSidebar";
import { AppRightPanel } from "../components/appshell/AppRightPanel";
import { WelcomeScreen } from "../components/appshell/WelcomeScreen";
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
  const [search, setSearch] = useState("");

  async function handleSend(presetWebSearch?: boolean) {
    const content = draft.trim();
    if (!content) return;
    const useWebSearch = presetWebSearch ?? webSearch;
    setDraft("");
    if (!activeId) {
      const conversation = await startNewConversation();
      if (!conversation) return;
      await sendMessage(content, conversation.id, useWebSearch);
      return;
    }
    await sendMessage(content, undefined, useWebSearch);
  }

  return (
    <AppShell
      sidebar={
        <AppSidebar
          mode="chat"
          search={search}
          onSearchChange={setSearch}
          onLiveSearchShortcut={() => {
            startComposing();
            setWebSearch(true);
          }}
          onNewChat={startComposing}
        />
      }
      main={
        <div className="flex h-full min-h-0 flex-1 flex-col">
          {error && (
            <p className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          {!activeId ? (
            <WelcomeScreen
              title="Welcome to Harrier Kavach"
              subtitle="Ask anything, ground answers in your documents, or search the live web — all on infrastructure you control."
              actions={[
                {
                  icon: "💬",
                  chipColor: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
                  label: "Ask a question",
                  onClick: () => startComposing(),
                },
                {
                  icon: "📄",
                  chipColor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
                  label: "Search my documents",
                  onClick: () => (window.location.href = "/rag"),
                },
                {
                  icon: "🌐",
                  chipColor: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
                  label: "Search the web",
                  onClick: () => {
                    startComposing();
                    setWebSearch(true);
                  },
                },
                {
                  icon: "🔑",
                  chipColor: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-400",
                  label: "Get an API key",
                  onClick: () => (window.location.href = "/rag?view=keys"),
                },
              ]}
            />
          ) : (
            <MessageThread
              messages={messages}
              sending={sending}
              emptyTitle="Start a conversation"
              emptyBody="Ask anything — this is a general-purpose chat against the model, no documents involved."
            />
          )}

          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={() => void handleSend()}
            disabled={sending}
            placeholder="Message Harrier…"
            webSearch={webSearch}
            onToggleWebSearch={() => setWebSearch((v) => !v)}
          />
        </div>
      }
      rightPanel={
        <AppRightPanel
          conversations={conversations}
          activeId={activeId}
          search={search}
          onSelect={(id) => void selectConversation(id)}
          onDelete={(id) => void deleteConversation(id)}
          onNewChat={startComposing}
        />
      }
    />
  );
}

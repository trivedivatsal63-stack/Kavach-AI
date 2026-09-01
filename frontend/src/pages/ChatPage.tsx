import { useState } from "react";
import { AppShell } from "../components/appshell/AppShell";
import { AppSidebar } from "../components/appshell/AppSidebar";
import { WelcomeScreen } from "../components/appshell/WelcomeScreen";
import { MessageThread } from "../components/chat/MessageThread";
import { Composer } from "../components/chat/Composer";
import { useAuth } from "../context/AuthContext";
import { useConversation } from "../hooks/useConversation";
import { ComplianceFlow } from "../components/compliance/ComplianceFlow";

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
    deleteConversation,
    sendMessage,
  } = useConversation(token, "chat");

  const [draft, setDraft] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string | undefined>();
  const [showCompliance, setShowCompliance] = useState(false);
  const [complianceRunId, setComplianceRunId] = useState<string | null>(null);

  async function handleSend(preset?: string, forceWeb?: boolean) {
    if (preset === "__COMPLIANCE__") { setShowCompliance(true); return; }
    const content = (preset ?? draft).trim();
    if (!content || sending) return;
    const useWebSearch = forceWeb ?? webSearch;
    setDraft("");
    // sendMessage creates the conversation lazily and immediately flips the
    // UI into the thread with a user bubble + "Generating…".
    await sendMessage(content, activeId ?? undefined, useWebSearch);
  }

  const inThread = Boolean(activeId) || messages.length > 0 || sending;

  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      onSubmit={() => void handleSend()}
      disabled={sending}
      placeholder="How can I help you today?"
      webSearch={webSearch}
      onToggleWebSearch={() => setWebSearch((v) => !v)}
      compact={!inThread}
    />
  );

  return (
    <AppShell
      sidebar={
        <AppSidebar
          mode="chat"
          onNewChat={startComposing}
          conversations={conversations}
          activeId={activeId}
          onSelectConversation={(id) => void selectConversation(id)}
          onDeleteConversation={(id) => void deleteConversation(id)}
          onSelectComplianceRun={(id) => { setComplianceRunId(id); setShowCompliance(true); }}
        />
      }
      main={
        <div className="flex h-full min-h-0 flex-1 flex-col">
          {error && (
            <p className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          {showCompliance ? (
            <div className="flex-1 overflow-y-auto p-6">
              <ComplianceFlow token={token!} initialRunId={complianceRunId} onClose={() => { setShowCompliance(false); setComplianceRunId(null); }} />
            </div>
          ) : !inThread ? (
            <WelcomeScreen
              activeCategoryId={activeCategoryId}
              onCategory={(c) => {
                if (c.id === "compliance" || c.prompt === "__COMPLIANCE__") { setShowCompliance(true); return; }
                setActiveCategoryId(c.id);
                if (c.prompt) setDraft(c.prompt);
              }}
              onCard={(c) => {
                if (c.id === "c4" || c.prompt === "__COMPLIANCE__") { setShowCompliance(true); return; }
                void handleSend(c.prompt);
              }}
              composer={composer}
            />
          ) : (
            <>
              <div className="shrink-0 p-2 flex justify-end">
                <button onClick={() => setShowCompliance(true)} className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white">Compliance check</button>
              </div>
              <MessageThread
                messages={messages}
                sending={sending}
                emptyTitle="Start a conversation"
                emptyBody="Ask anything — general chat against Llama 3.1 8B Instruct."
              />
              {composer}
            </>
          )}
        </div>
      }
    />
  );
}

import { Link, useNavigate } from "react-router-dom";
import { ShieldMark } from "../ShieldMark";
import { useAuth } from "../../context/AuthContext";
import { listComplianceRuns } from "../../lib/api";
import type { ConversationSummary } from "../../lib/api";
import { useEffect, useState } from "react";

function NavBtn({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
        active
          ? "bg-white text-gray-900 shadow-sm dark:bg-neutral-800 dark:text-white"
          : "text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-neutral-800/70"
      }`}
    >
      {label}
    </button>
  );
}

export function AppSidebar({
  mode,
  onNewChat,
  conversations = [],
  activeId = null,
  onSelectConversation,
  onDeleteConversation,
  onSelectComplianceRun,
}: {
  mode: "chat" | "rag";
  onNewChat: () => void;
  conversations?: ConversationSummary[];
  activeId?: string | null;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  onSelectComplianceRun?: (id: string) => void;
}) {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();
  const [complianceRuns, setComplianceRuns] = useState<any[]>([]);
  useEffect(() => {
    if (!token) return;
    listComplianceRuns(token).then((r) => setComplianceRuns(r.runs)).catch(() => {});
  }, [token, conversations.length]);

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-gray-200/80 bg-[#ececee] dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2 px-4 py-4">
        <Link to="/" className="block min-w-0">
          <ShieldMark className="h-10 w-auto max-w-[140px]" />
        </Link>
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        <NavBtn
          active={mode === "chat"}
          label="Chat"
          onClick={() => navigate("/chat")}
        />
        <NavBtn
          active={mode === "rag"}
          label="RAG"
          onClick={() => navigate("/rag")}
        />
        {user?.role === "superadmin" && (
          <NavBtn
            active={false}
            label="Admin"
            onClick={() => navigate("/admin")}
          />
        )}
      </nav>

      <div className="mt-3 px-3">
        <button
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-white/70 dark:text-gray-200 dark:hover:bg-neutral-800/70"
        >
          <span className="text-base leading-none">+</span>
          New Chat
        </button>
        {mode === "rag" && (
          <button
            onClick={() => navigate("/rag?view=documents")}
            className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-white/70 dark:text-gray-200 dark:hover:bg-neutral-800/70"
          >
            Documents
          </button>
        )}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-2 space-y-4">
        {conversations.length > 0 && (
          <div>
            <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-wider text-gray-400 uppercase">Recent</p>
            <ul className="space-y-0.5">
              {conversations.slice(0, 20).map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    onClick={() => onSelectConversation?.(c.id)}
                    className={`w-full truncate rounded-lg px-3 py-2 text-left text-xs transition-colors ${c.id === activeId ? "bg-white font-medium text-gray-900 shadow-sm dark:bg-neutral-800 dark:text-white" : "text-gray-600 hover:bg-white/60 dark:text-gray-400 dark:hover:bg-neutral-800/60"}`}
                  >
                    {c.title}
                  </button>
                  {onDeleteConversation && (
                    <button onClick={() => onDeleteConversation(c.id)} aria-label={`Delete ${c.title}`} className="absolute top-1 right-1 hidden rounded p-0.5 text-gray-400 group-hover:block hover:text-red-600">×</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {complianceRuns.length > 0 && (
          <div>
            <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-wider text-gray-400 uppercase">Compliance checks</p>
            <ul className="space-y-1">
              {complianceRuns.slice(0, 10).map((r: any) => (
                <li key={r.id}>
                  <button
                    onClick={() => onSelectComplianceRun ? onSelectComplianceRun(r.id) : navigate("/chat")}
                    className="w-full rounded-lg bg-white/60 px-3 py-2 text-left hover:bg-white dark:bg-neutral-800/60 dark:hover:bg-neutral-800"
                  >
                    <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                      {r.sources?.join(", ")} · {new Date(r.createdAt).toLocaleDateString()} {r.status === "running" && <span className="ml-1 text-amber-600">● running</span>}
                    </p>
                    <p className="text-[11px] text-gray-500">{r.totalCirculars || r.completed}/{r.totalCirculars} circulars · {r.pendingApplicable != null ? `${r.pendingApplicable} applicable` : r.status}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {conversations.length === 0 && complianceRuns.length === 0 && <div className="flex-1" />}
      </div>

      <div className="border-t border-gray-200/80 p-3 dark:border-neutral-800">
        {token ? (
          <div className="space-y-2">
            <div className="px-1">
              <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                {user?.name || user?.email}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                ${Number(user?.creditBalanceUsd ?? 0).toFixed(2)} credits left
              </p>
            </div>
            <button
              onClick={() => navigate("/dashboard")}
              className="w-full rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
            >
              Dashboard
            </button>
            <button
              onClick={logout}
              className="w-full rounded-full border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
            >
              Sign out
            </button>
          </div>
        ) : (
          <Link
            to="/login"
            className="flex w-full items-center justify-center rounded-full border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
          >
            Sign in
          </Link>
        )}
      </div>
    </aside>
  );
}

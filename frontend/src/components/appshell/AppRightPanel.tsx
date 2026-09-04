import type { ConversationSummary } from "../../lib/api";
import { XIcon } from "../icons";

// Right panel — "Conversations", not "Projects" (no project concept exists
// in Kavach). Same component, same useConversation-backed data, for both
// Chat and RAG Studio. Shows a relative timestamp rather than a fake
// message-preview snippet, since ConversationSummary doesn't carry one and
// nothing here should show text that isn't real.
export function AppRightPanel({
  conversations,
  activeId,
  search,
  onSelect,
  onDelete,
  onNewChat,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  search: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
}) {
  const filtered = search.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(search.trim().toLowerCase())
      )
    : conversations;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-gray-200 bg-white dark:border-neutral-800 dark:bg-black">
      <div className="flex items-center justify-between px-4 py-4">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          Conversations{" "}
          <span className="text-gray-400 dark:text-gray-500">
            ({conversations.length})
          </span>
        </p>
        <button
          onClick={onNewChat}
          aria-label="New chat"
          title="New chat"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-neutral-800 dark:hover:text-white"
        >
          +
        </button>
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {filtered.length === 0 && (
          <li className="px-2 py-8 text-center text-xs text-gray-400 dark:text-gray-500">
            {search.trim() ? "No matches." : "No conversations yet."}
          </li>
        )}
        {filtered.map((c) => (
          <li key={c.id}>
            <div
              className={`group flex items-start justify-between gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                c.id === activeId
                  ? "border-gray-300 bg-gray-50 dark:border-neutral-700 dark:bg-neutral-900"
                  : "border-transparent hover:border-gray-200 hover:bg-gray-50 dark:hover:border-neutral-800 dark:hover:bg-neutral-900/60"
              }`}
            >
              <button
                onClick={() => onSelect(c.id)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {c.title}
                </p>
                <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                  {relativeTime(c.updatedAt)}
                </p>
              </button>
              <button
                onClick={() => onDelete(c.id)}
                aria-label={`Delete ${c.title}`}
                className="shrink-0 rounded p-1 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-200 hover:text-red-600 dark:hover:bg-neutral-700 dark:hover:text-red-400"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

import type { ConversationSummary } from "../../lib/api";

export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  newLabel = "New chat",
  emptyLabel = "No conversations yet.",
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  newLabel?: string;
  emptyLabel?: string;
}) {
  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="border-b border-gray-100 p-3 dark:border-neutral-800">
        <button onClick={onNew} className="btn-primary w-full">
          + {newLabel}
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {conversations.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-500">
            {emptyLabel}
          </li>
        )}
        {conversations.map((c) => (
          <li key={c.id}>
            <div
              className={`group flex items-center gap-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                c.id === activeId
                  ? "bg-gray-100 dark:bg-neutral-800"
                  : "hover:bg-gray-50 dark:hover:bg-neutral-800/60"
              }`}
            >
              <button
                onClick={() => onSelect(c.id)}
                className="min-w-0 flex-1 truncate text-left"
              >
                {c.title}
              </button>
              <button
                onClick={() => onDelete(c.id)}
                className="shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-gray-200 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-red-400"
                aria-label={`Delete ${c.title}`}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

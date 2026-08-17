import type { ReactNode } from "react";

export interface QuickAction {
  icon: ReactNode;
  chipColor: string;
  label: string;
  onClick: () => void;
}

// Center empty-state — heading, subtitle, 2x2 quick-action grid. Each page
// (Chat, RAG Studio) supplies its own 4 real actions rather than this
// component hardcoding cross-page navigation.
export function WelcomeScreen({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions: QuickAction[];
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
          {title}
        </h1>
        <p className="max-w-md text-sm text-gray-500 dark:text-gray-400">
          {subtitle}
        </p>
      </div>

      <div className="grid w-full max-w-lg grid-cols-2 gap-3">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
          >
            <span className="flex items-center gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base ${action.chipColor}`}
              >
                {action.icon}
              </span>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {action.label}
              </span>
            </span>
            <span className="shrink-0 text-lg leading-none text-gray-300 dark:text-gray-600">
              +
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

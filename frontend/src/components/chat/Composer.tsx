// Must match backend/src/utils/chat.constants.ts's MAX_MESSAGE_CHARS — no
// shared package between frontend/backend, so this is a synced duplicate,
// not a guess.
const MAX_MESSAGE_CHARS = 4000;

import { PaperclipIcon, GlobeIcon, StopIcon } from "../icons";

// Real current model — backend CHAT_MODEL / VLLM_SERVED_NAME.
const MODEL_NAME = "mistral-small-24b-awq";

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  streaming,
  onStop,
  placeholder,
  webSearch,
  onToggleWebSearch,
  onAttach,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  /** True while a streamed reply is in flight — send becomes Stop. */
  streaming?: boolean;
  onStop?: () => void;
  placeholder: string;
  /** Omit both props to hide the toggle entirely (not every caller wants it). */
  webSearch?: boolean;
  onToggleWebSearch?: () => void;
  /** RAG mode only — attaching/scoping documents to the conversation. */
  onAttach?: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-gray-100 p-4 dark:border-neutral-800">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="rounded-2xl border border-gray-200 bg-white shadow-sm transition-colors focus-within:border-gray-400 dark:border-neutral-800 dark:bg-neutral-900 dark:focus-within:border-neutral-600"
      >
        <div className="flex items-center gap-2 px-4 pt-3">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
            placeholder={placeholder}
            className="flex-1 border-none bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop generating"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            >
              <StopIcon className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || !value.trim()}
              aria-label="Send"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M2.94 17.06a.75.75 0 0 0 .82.16l13.5-6a.75.75 0 0 0 0-1.37l-13.5-6a.75.75 0 0 0-1.02.93L5.5 10 2.74 16.22a.75.75 0 0 0 .2.84Z" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-3 pt-1.5 pb-2.5">
          <div className="flex items-center gap-1">
            {onAttach && (
              <button
                type="button"
                onClick={onAttach}
                title="Attach documents"
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-neutral-800"
              >
                <PaperclipIcon className="h-4 w-4" />
                Attach
              </button>
            )}
            {onToggleWebSearch && (
              <button
                type="button"
                onClick={onToggleWebSearch}
                aria-pressed={webSearch}
                title={
                  webSearch
                    ? "Web search is on — this message will be grounded with live results"
                    : "Turn on web search for this message"
                }
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                  webSearch
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-neutral-800"
                }`}
              >
                <GlobeIcon className="h-4 w-4" />
                Web search
              </button>
            )}
          </div>
          <span className="text-xs text-gray-300 dark:text-gray-600">
            {value.length} / {MAX_MESSAGE_CHARS}
          </span>
        </div>
      </form>
      <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-600">
        Harrier may generate inaccurate information. Model: {MODEL_NAME}
      </p>
    </div>
  );
}

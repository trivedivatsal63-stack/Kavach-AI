import { MODEL_LABEL, MODEL_NAME } from "../../lib/modelInfo";

const MAX_MESSAGE_CHARS = 4000;

/** Large rounded composer matching the centered hero / thread footer. */
export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  webSearch,
  onToggleWebSearch,
  onAttach,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder: string;
  webSearch?: boolean;
  onToggleWebSearch?: () => void;
  onAttach?: () => void;
  /** Slightly tighter padding when embedded in the welcome hero */
  compact?: boolean;
}) {
  return (
    <div className={compact ? "" : "shrink-0 px-4 pb-5 pt-2 sm:px-6"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="mx-auto w-full max-w-3xl rounded-[28px] border border-gray-200 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.06)] focus-within:border-gray-300 dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-none"
      >
        <div className={`flex items-end gap-2 px-4 ${compact ? "pt-3" : "pt-4"}`}>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            rows={1}
            placeholder={placeholder}
            className="max-h-40 min-h-[44px] flex-1 resize-none border-none bg-transparent py-2.5 text-[15px] text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <button
            type="submit"
            disabled={disabled || !value.trim()}
            aria-label="Send"
            className="mb-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-500 transition-colors enabled:bg-gray-900 enabled:text-white enabled:hover:bg-gray-700 disabled:cursor-not-allowed dark:bg-neutral-800 dark:enabled:bg-white dark:enabled:text-gray-900"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M10 3.5a.75.75 0 0 1 .75.75v9.69l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V4.25A.75.75 0 0 1 10 3.5Z" />
            </svg>
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <div className="flex items-center gap-1">
            {onAttach && (
              <button
                type="button"
                onClick={onAttach}
                className="rounded-full px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-800"
              >
                + Attach
              </button>
            )}
            {onToggleWebSearch && (
              <button
                type="button"
                onClick={onToggleWebSearch}
                aria-pressed={webSearch}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  webSearch
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-800"
                }`}
              >
                Web
              </button>
            )}
            <span className="hidden px-2 text-[10px] text-gray-400 sm:inline dark:text-gray-600">
              {MODEL_NAME}
            </span>
          </div>
          <span className="text-[10px] text-gray-300 dark:text-gray-600">
            {value.length}/{MAX_MESSAGE_CHARS} · {MODEL_LABEL.split(" · ")[0]}
          </span>
        </div>
      </form>
      {!compact && (
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-gray-400 dark:text-gray-600">
          Harrier may generate inaccurate information. Model: {MODEL_NAME} ({MODEL_LABEL})
        </p>
      )}
    </div>
  );
}

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  webSearch,
  onToggleWebSearch,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder: string;
  /** Omit both props to hide the toggle entirely (not every caller wants it). */
  webSearch?: boolean;
  onToggleWebSearch?: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex items-center gap-2 border-t border-gray-100 p-4 dark:border-gray-800"
    >
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
          className={`shrink-0 rounded-full border px-3 py-2 text-sm transition-colors ${
            webSearch
              ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-400"
              : "border-gray-200 text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/60"
          }`}
        >
          🌐
        </button>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input flex-1"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="btn-primary"
      >
        {disabled ? "Working…" : "Send"}
      </button>
    </form>
  );
}

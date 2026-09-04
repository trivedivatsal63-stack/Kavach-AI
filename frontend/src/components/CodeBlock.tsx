import { useState } from "react";

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative">
      {lang && (
        <span className="absolute top-2 left-3 text-[11px] text-gray-500 select-none">
          {lang}
        </span>
      )}
      <button
        onClick={() => void handleCopy()}
        className="absolute right-2 top-2 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 opacity-0 transition-opacity hover:bg-gray-700 group-hover:opacity-100"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="code-block">
        <code>{code}</code>
      </pre>
    </div>
  );
}

import { useState } from "react";

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative">
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

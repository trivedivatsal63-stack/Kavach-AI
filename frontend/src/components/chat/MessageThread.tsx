import { useEffect, useRef } from "react";
import { Spinner } from "../Spinner";
import { Citations } from "./Citations";
import { WebCitations } from "./WebCitations";
import type { RagCitation, WebCitation } from "../../lib/api";

function renderWithInlineCites(content: string, webCitations: WebCitation[]) {
  const parts = content.split(/(\[\d+\])/g);
  return parts.map((part, idx) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return <span key={idx}>{part}</span>;
    const n = parseInt(m[1], 10);
    const cite = webCitations[n - 1];
    if (!cite) return <span key={idx}>{part}</span>;
    return (
      <a
        key={idx}
        href={cite.url}
        target="_blank"
        rel="noopener noreferrer"
        title={cite.title}
        className="mx-0.5 inline-flex h-4 items-center rounded-full border border-indigo-200 bg-indigo-50 px-1.5 text-[10px] font-semibold leading-none text-indigo-700 no-underline hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
      >
        {n}
      </a>
    );
  });
}

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: RagCitation[] | null;
  webCitations?: WebCitation[] | null;
  /** Local-only failure bubble — never persisted to the backend. */
  error?: boolean;
}

export function MessageThread({
  messages,
  sending,
  emptyTitle,
  emptyBody,
}: {
  messages: UIMessage[];
  sending: boolean;
  emptyTitle: string;
  emptyBody: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      {messages.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {emptyTitle}
          </p>
          <p className="max-w-xs text-xs text-gray-400 dark:text-gray-500">
            {emptyBody}
          </p>
        </div>
      )}
      {messages.map((m) => (
        <div
          key={m.id}
          className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
              m.role === "user"
                ? "bg-indigo-600 text-white"
                : m.error
                  ? "border border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400"
                  : "border border-gray-200 bg-gray-50 text-gray-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
            }`}
          >
            <p className="whitespace-pre-wrap">
              {m.role === "assistant" && m.webCitations && m.webCitations.length > 0
                ? renderWithInlineCites(m.content, m.webCitations)
                : m.content}
            </p>
            {m.citations && m.citations.length > 0 && (
              <Citations citations={m.citations} />
            )}
            {m.webCitations && m.webCitations.length > 0 && (
              <WebCitations citations={m.webCitations} />
            )}
          </div>
        </div>
      ))}
      {sending && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Spinner />
          Thinking…
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

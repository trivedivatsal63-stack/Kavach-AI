import { useEffect, useRef } from "react";
import { Spinner } from "../Spinner";
import { Citations } from "./Citations";
import { WebCitations } from "./WebCitations";
import type { RagCitation, WebCitation } from "../../lib/api";

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
                  : "border border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            }`}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
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

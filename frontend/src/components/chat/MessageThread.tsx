import { useEffect, useRef, useState } from "react";
import { Spinner } from "../Spinner";
import { AgentStatus, type AgentPhase } from "./AgentStatus";
import { Citations } from "./Citations";
import { WebCitations } from "./WebCitations";
import { Markdown } from "./Markdown";
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
  streamPhases = [],
  streamingText = "",
  streamingCitations = [],
  emptyTitle,
  emptyBody,
  onRetry,
}: {
  messages: UIMessage[];
  sending: boolean;
  /** Live SSE phases for the AgentStatus timeline (empty = classic mode). */
  streamPhases?: AgentPhase[];
  /** Live completion text while tokens stream. */
  streamingText?: string;
  streamingCitations?: WebCitation[];
  emptyTitle: string;
  emptyBody: string;
  /** Retry a failed turn — called with the failed turn's user content. */
  onRetry?: (content: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Pinned = user is at (or near) the bottom, so live updates may
  // auto-scroll. Reading history unpins; the jump button restores it.
  const [pinned, setPinned] = useState(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  useEffect(() => {
    if (pinned) {
      endRef.current?.scrollIntoView({ behavior: sending ? "auto" : "smooth" });
    }
  }, [messages, sending, streamingText, pinned]);

  useEffect(() => {
    // A new outgoing turn re-pins the view.
    if (sending) setPinned(true);
  }, [sending]);

  // Content of the most recent user turn before each message — powers Retry
  // on local-only error bubbles without touching persisted history.
  let lastUserContent = "";
  const retryFor = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "user") lastUserContent = m.content;
    else if (m.error) retryFor.set(m.id, lastUserContent);
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5"
    >
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
                ? "bg-gray-200 text-gray-900 dark:bg-neutral-700 dark:text-gray-100"
                : m.error
                  ? "border border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400"
                  : "border border-gray-200 bg-gray-50 text-gray-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
            }`}
          >
            {m.role === "assistant" && !m.error ? (
              <div className="text-sm">
                <Markdown content={m.content} webCitations={m.webCitations ?? []} />
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{m.content}</p>
            )}
            {m.error && onRetry && retryFor.get(m.id) && (
              <button
                onClick={() => onRetry(retryFor.get(m.id) as string)}
                disabled={sending}
                className="btn-secondary mt-2 px-2.5 py-1 text-xs disabled:opacity-40"
              >
                Retry
              </button>
            )}
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
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-neutral-700 dark:bg-neutral-800">
            {streamPhases.length > 0 ? (
              <AgentStatus phases={streamPhases} active />
            ) : (
              <div className="flex flex-col gap-2 py-1" aria-label="Thinking">
                <div className="h-2.5 w-48 animate-pulse rounded bg-gray-200 dark:bg-neutral-700" />
                <div className="h-2.5 w-36 animate-pulse rounded bg-gray-200 dark:bg-neutral-700" />
                <div className="flex items-center gap-2 pt-1 text-xs text-gray-400">
                  <Spinner />
                  Thinking…
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {streamingText && (
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm dark:border-neutral-700 dark:bg-neutral-800">
            <div className="text-sm">
              <Markdown content={streamingText} webCitations={streamingCitations} />
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-gray-400 align-middle dark:bg-gray-500" />
            </div>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
    {!pinned && (sending || streamingText) && (
      <button
        onClick={() => {
          setPinned(true);
          endRef.current?.scrollIntoView({ behavior: "smooth" });
        }}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-md transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-300 dark:hover:bg-neutral-800"
      >
        Jump to latest
      </button>
    )}
    </div>
  );
}

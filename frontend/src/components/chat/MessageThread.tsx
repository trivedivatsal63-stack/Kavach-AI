import { useEffect, useRef, type ReactNode } from "react";
import { Spinner } from "../Spinner";
import { Citations } from "./Citations";
import { WebCitations } from "./WebCitations";
import { MarkdownContent } from "./MarkdownContent";
import type { RagCitation, WebCitation } from "../../lib/api";

function renderWithInlineCites(content: string, webCitations: WebCitation[]): ReactNode {
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
        className="mx-0.5 inline-flex h-4 items-center rounded-full border border-gray-300 bg-gray-100 px-1.5 text-[10px] font-semibold leading-none text-gray-700 no-underline hover:bg-gray-200 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200"
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
  /** Client-measured generation time for assistant replies (ms). */
  latencyMs?: number;
  /** LiteLLM-reported cost for this turn (USD). */
  costUsd?: number;
  promptTokens?: number;
  completionTokens?: number;
  error?: boolean;
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
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
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-1 py-16 text-center">
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
              className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm sm:max-w-[85%] ${
                m.role === "user"
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : m.error
                    ? "border border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400"
                    : "border border-gray-200/80 bg-white text-gray-900 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-100"
              }`}
            >
              {m.role === "assistant" && !m.error ? (
                m.webCitations && m.webCitations.length > 0 ? (
                  <div className="md-body whitespace-pre-wrap">
                    {renderWithInlineCites(m.content, m.webCitations)}
                  </div>
                ) : (
                  <MarkdownContent content={m.content} />
                )
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
              {m.citations && m.citations.length > 0 && (
                <Citations citations={m.citations} />
              )}
              {m.webCitations && m.webCitations.length > 0 && (
                <WebCitations citations={m.webCitations} />
              )}
              {m.role === "assistant" &&
                typeof m.latencyMs === "number" &&
                m.latencyMs >= 0 &&
                !m.error && (
                  <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-400 dark:border-neutral-800 dark:text-gray-500">
                    Generated in {formatLatency(m.latencyMs)}
                    {typeof m.costUsd === "number" && (
                      <>
                        {" · "}
                        Billed ${m.costUsd.toFixed(4)}
                      </>
                    )}
                    {typeof m.promptTokens === "number" &&
                      typeof m.completionTokens === "number" && (
                        <>
                          {" · "}
                          {m.promptTokens + m.completionTokens} tokens
                        </>
                      )}
                  </p>
                )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Spinner />
            Generating…
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

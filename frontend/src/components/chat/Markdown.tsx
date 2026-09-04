import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Children, cloneElement, isValidElement } from "react";
import type { ReactNode } from "react";
import { CodeBlock } from "../CodeBlock";
import type { WebCitation } from "../../lib/api";

// Assistant-message markdown: GFM (tables, code, lists) with the platform's
// [n] web-citation pills preserved inside prose. Code spans/blocks and links
// are left untouched by cite processing so `[0]` inside code never becomes
// a pill. Streaming-safe: react-markdown tolerates unclosed fences/tables
// in partial text.

function CitePill({ n, cite }: { n: number; cite: WebCitation }) {
  return (
    <a
      href={cite.url}
      target="_blank"
      rel="noopener noreferrer"
      title={cite.title}
      className="mx-0.5 inline-flex h-4 items-center rounded-full border border-gray-300 bg-gray-100 px-1.5 text-[10px] font-semibold leading-none text-gray-700 no-underline hover:bg-gray-200 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-300 dark:hover:bg-neutral-700"
    >
      {n}
    </a>
  );
}

function splitWithCites(text: string, webCitations: WebCitation[]): ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, idx) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return <span key={idx}>{part}</span>;
    const n = parseInt(m[1], 10);
    const cite = webCitations[n - 1];
    if (!cite) return <span key={idx}>{part}</span>;
    return <CitePill key={idx} n={n} cite={cite} />;
  });
}

/** Recursively processes element children, skipping code/pre/link subtrees. */
function withCites(node: ReactNode, webCitations: WebCitation[]): ReactNode {
  return Children.map(node, (child, idx) => {
    if (typeof child === "string" || typeof child === "number") {
      return <span key={idx}>{splitWithCites(String(child), webCitations)}</span>;
    }
    if (isValidElement(child)) {
      const type = typeof child.type === "string" ? child.type : "";
      if (type === "code" || type === "pre" || type === "a") return child;
      const props = child.props as { children?: ReactNode };
      if (props.children == null) return child;
      return cloneElement(child, { key: (child.key ?? idx) as string }, withCites(props.children, webCitations));
    }
    return child;
  });
}

function proseComponents(webCitations: WebCitation[]): Components {
  const textBlock = (Tag: "p" | "li" | "td" | "th" | "h1" | "h2" | "h3" | "h4") =>
    function TextBlock({ children }: { children?: ReactNode }) {
      return <Tag>{withCites(children, webCitations)}</Tag>;
    };
  return {
    p: ({ children }) => (
      <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{withCites(children, webCitations)}</p>
    ),
    li: ({ children }) => <li className="my-0.5">{withCites(children, webCitations)}</li>,
    td: textBlock("td"),
    th: textBlock("th"),
    h1: ({ children }) => (
      <h1 className="mt-3 mb-1.5 text-base font-semibold first:mt-0">{withCites(children, webCitations)}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-3 mb-1.5 text-[15px] font-semibold first:mt-0">{withCites(children, webCitations)}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-2.5 mb-1 text-sm font-semibold first:mt-0">{withCites(children, webCitations)}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{withCites(children, webCitations)}</h4>
    ),
    ul: ({ children }) => <ul className="my-2 list-disc space-y-0.5 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-0.5 pl-5">{children}</ol>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-gray-300 pl-3 text-gray-600 dark:border-neutral-600 dark:text-gray-400">
        {children}
      </blockquote>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500 dark:text-white dark:decoration-neutral-600"
      >
        {children}
      </a>
    ),
    code: ({ className, children }) => {
      const text = String(children ?? "");
      // Fenced blocks are handled by `pre`; inline code gets a chip.
      if (className) return <code className={className}>{children}</code>;
      return (
        <code className="rounded bg-gray-200/70 px-1 py-0.5 font-mono text-[13px] dark:bg-neutral-700/70">
          {text}
        </code>
      );
    },
    pre: ({ children }) => {
      let code = "";
      let lang: string | undefined;
      Children.forEach(children, (child) => {
        if (isValidElement(child) && child.type === "code") {
          const props = child.props as { className?: string; children?: ReactNode };
          const m = /language-(\w+)/.exec(props.className ?? "");
          lang = m?.[1];
          code = String(props.children ?? "").replace(/\n$/, "");
        }
      });
      if (!code && typeof children === "string") code = children;
      return (
        <div className="my-2">
          <CodeBlock code={code} lang={lang} />
        </div>
      );
    },
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="border-b border-gray-200 dark:border-neutral-700">{children}</thead>,
    tr: ({ children }) => <tr className="border-b border-gray-100 last:border-0 dark:border-neutral-800">{children}</tr>,
    hr: () => <hr className="my-3 border-gray-200 dark:border-neutral-700" />,
  };
}

export function Markdown({
  content,
  webCitations = [],
}: {
  content: string;
  webCitations?: WebCitation[];
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={proseComponents(webCitations)}>
      {content}
    </ReactMarkdown>
  );
}

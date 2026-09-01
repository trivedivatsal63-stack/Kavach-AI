import type { ReactNode } from "react";

/** Minimal markdown → React for assistant replies (no extra dependency). */
export function MarkdownContent({
  content,
  inlineExtras,
}: {
  content: string;
  /** Optional map for tokens like [1] already expanded by caller — unused when plain. */
  inlineExtras?: (text: string) => ReactNode;
}) {
  const blocks = splitBlocks(content);

  return (
    <div className="md-body">
      {blocks.map((block, i) => {
        if (block.type === "pre") {
          return (
            <pre key={i}>
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === "ul" || block.type === "ol") {
          const Tag = block.type;
          return (
            <Tag key={i}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, inlineExtras)}</li>
              ))}
            </Tag>
          );
        }
        if (block.type === "h1" || block.type === "h2" || block.type === "h3") {
          const Tag = block.type;
          return <Tag key={i}>{renderInline(block.text, inlineExtras)}</Tag>;
        }
        if (block.type === "quote") {
          return (
            <blockquote key={i}>{renderInline(block.text, inlineExtras)}</blockquote>
          );
        }
        if (block.type === "p") {
          return <p key={i}>{renderInline(block.text, inlineExtras)}</p>;
        }
        return null;
      })}
    </div>
  );
}

type Block =
  | { type: "pre"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "h1" | "h2" | "h3" | "quote" | "p"; text: string };

function splitBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push({ type: "pre", text: buf.join("\n") });
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length as 1 | 2 | 3;
      out.push({
        type: (`h${level}` as "h1" | "h2" | "h3"),
        text: line.replace(/^#{1,3}\s+/, ""),
      });
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      out.push({ type: "quote", text: buf.join("\n") });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i += 1;
      }
      out.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      out.push({ type: "ol", items });
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const buf: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("```") &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    out.push({ type: "p", text: buf.join("\n") });
  }
  return out;
}

function renderInline(
  text: string,
  inlineExtras?: (text: string) => ReactNode
): ReactNode {
  if (inlineExtras) return inlineExtras(text);

  const nodes: ReactNode[] = [];
  const re =
    /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("`")) {
      nodes.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    } else {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        nodes.push(
          <a key={key++} href={lm[2]} target="_blank" rel="noopener noreferrer">
            {lm[1]}
          </a>
        );
      } else {
        nodes.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

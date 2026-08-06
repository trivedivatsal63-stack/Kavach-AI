import {
  MAX_CHUNK_CHARS,
  MAX_OVERLAP_CHARS,
  MIN_CHUNK_CHARS,
} from "../constants";

export interface Chunk {
  content: string;
  headingPath: string[];
  page: number | null;
  tokenCount: number;
}

export interface ChunkingInput {
  text: string;
  pageCount: number | null;
}

interface Heading {
  level: number;
  text: string;
}

type BlockKind = "paragraph" | "table";

interface Block {
  kind: BlockKind;
  text: string;
  headingPath: string[];
}

interface AssembledChunk {
  text: string;
  headingPath: string[];
}

// Structure-aware chunker. It reads the document as a heading tree:
//   - Markdown ATX headings (#/##/...), numbered headings (1., 1.1.) and
//     standalone ALL-CAPS lines become section boundaries.
//   - Content under the current section groups into chunks of up to
//     MAX_CHUNK_CHARS, splitting only between paragraphs (semantic
//     boundaries) so a sentence is never cut in half.
//   - Tables (lines with | or tab separators) stay whole as their own chunk
//     and are hard-split only if a single table exceeds the limit.
//   - Each chunk carries its heading path + source metadata for citation.
//
// pageCount is accepted for future per-page extraction; pdf-parse gives us
// whole-document text without page markers, so chunk-level pages are null
// for now (kept in the schema so a better parser can fill them in).
export function chunkDocument(input: ChunkingInput): Chunk[] {
  const lines = input.text.replace(/\r\n/g, "\n").split("\n");
  const blocks = buildBlocks(lines);
  const assembled = assembleChunks(blocks);

  return assembled.map((chunk) => ({
    content: chunk.text,
    headingPath: chunk.headingPath,
    page: null,
    tokenCount: estimateTokens(chunk.text),
  }));
}

function buildBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  const stack: Heading[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    const raw = buffer.join("\n").trim();
    buffer = [];
    if (!raw) return;
    blocks.push({
      kind: isTable(raw) ? "table" : "paragraph",
      text: raw,
      headingPath: stack.map((h) => h.text),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const nextIsBlank = !lines[i + 1]?.trim();
    const heading = detectHeading(lines[i], nextIsBlank);
    if (heading) {
      flushBuffer();
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }
      stack.push({ level: heading.level, text: heading.text });
      continue;
    }
    buffer.push(lines[i]);
  }
  flushBuffer();
  return blocks;
}

function detectHeading(
  line: string,
  nextIsBlank: boolean
): { level: number; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Markdown ATX: # Section, ## Sub-section, ... — a # is always a heading.
  const atx = /^(#{1,6})\s+(.+)$/.exec(trimmed);
  if (atx) {
    return { level: atx[1].length, text: atx[2].replace(/\s*#+\s*$/, "").trim() };
  }

  // Numbered headings: "1. Intro", "2.1 Setup" — only when standalone
  // (followed by a blank line) or ending in ":" so ordinary numbered list
  // items ("1. do this then 2. do that") aren't mistaken for headings.
  const numbered = /^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/.exec(trimmed);
  if (numbered) {
    const level = numbered[1].split(".").length;
    const text = numbered[2].trim();
    if (text.length <= 120 && (nextIsBlank || text.endsWith(":"))) {
      return { level, text };
    }
  }

  // Standalone ALL-CAPS short line (e.g. "INTRODUCTION") — a weak heading.
  if (
    trimmed.length <= 60 &&
    trimmed === trimmed.toUpperCase() &&
    /[A-Z]{2,}/.test(trimmed) &&
    !/^\d+$/.test(trimmed) &&
    nextIsBlank
  ) {
    return { level: 1, text: trimmed };
  }

  return null;
}

function isTable(block: string): boolean {
  const lines = block.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  const separatorLines = lines.filter(
    (l) => l.includes("|") || l.includes("\t")
  );
  return separatorLines.length / lines.length >= 0.6;
}

function assembleChunks(blocks: Block[]): AssembledChunk[] {
  const chunks: AssembledChunk[] = [];
  let current: AssembledChunk | null = null;

  const flush = () => {
    if (current && current.text.trim()) {
      chunks.push(current);
    }
    current = null;
  };

  const emit = (text: string, headingPath: string[]) => {
    if (!text.trim()) return;
    if (text.length <= MAX_CHUNK_CHARS) {
      chunks.push({ text: text.trim(), headingPath });
      return;
    }
    for (const part of hardSplit(text)) {
      if (part.trim()) chunks.push({ text: part.trim(), headingPath });
    }
  };

  for (const block of blocks) {
    if (block.kind === "table") {
      flush();
      emit(block.text, block.headingPath);
      continue;
    }

    if (
      current &&
      (!pathsEqual(current.headingPath, block.headingPath) ||
        current.text.length + 1 + block.text.length > MAX_CHUNK_CHARS)
    ) {
      flush();
    }

    if (!current) {
      if (block.text.length <= MAX_CHUNK_CHARS) {
        current = { text: block.text.trim(), headingPath: block.headingPath };
      } else {
        emit(block.text, block.headingPath);
      }
      continue;
    }

    current.text += "\n\n" + block.text.trim();
  }

  flush();

  // Tiny fragments (< MIN_CHUNK_CHARS and sharing a heading path) get merged
  // into the previous chunk so a document doesn't produce dozens of one-line
  // chunks — but never across different sections.
  const merged: AssembledChunk[] = [];
  for (const chunk of chunks) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.text.length < MIN_CHUNK_CHARS &&
      pathsEqual(prev.headingPath, chunk.headingPath) &&
      prev.text.length + 1 + chunk.text.length <= MAX_CHUNK_CHARS
    ) {
      prev.text += "\n\n" + chunk.text;
    } else {
      merged.push({ ...chunk });
    }
  }
  return merged;
}

function pathsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// Splits an oversized block at sentence boundaries, carrying a small tail of
// the previous part so context survives the cut.
function hardSplit(text: string): string[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > MAX_CHUNK_CHARS) {
      const tail = current.slice(-MAX_OVERLAP_CHARS).trim();
      parts.push(current.trim());
      current = tail ? `${tail} ${sentence}` : sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const final: string[] = [];
  for (const part of parts) {
    if (part.length <= MAX_CHUNK_CHARS) {
      final.push(part);
    } else {
      final.push(...hardCut(part));
    }
  }
  return final;
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?。！？\n]+[.!?。！？]+\s*|[^.!?。！？\n]+$/g);
  return (matches ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
}

function hardCut(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHUNK_CHARS) {
    let cut = MAX_CHUNK_CHARS;
    const space = rest.lastIndexOf(" ", MAX_CHUNK_CHARS);
    if (space > MAX_CHUNK_CHARS * 0.5) cut = space;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(Math.max(1, cut - MAX_OVERLAP_CHARS));
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

// Rough token estimate (~4 chars per token) — only used for chunk sizing
// stats and citation context, never for billing.
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

import {
  JUNK_SECTION_HEADINGS,
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
    content: withHeadingPrefix(chunk.headingPath, chunk.text),
    headingPath: chunk.headingPath,
    page: null,
    tokenCount: estimateTokens(chunk.text),
  }));
}

// Headings are kept OUT of the stored text (the UI already shows the heading
// path), but they are embedded INTO the vector: without them, entity facts
// that only appear as a heading (an ALL-CAPS author name, a section title)
// never reach the embedding, so queries about that entity miss the chunk.
function withHeadingPrefix(headingPath: string[], text: string): string {
  if (headingPath.length === 0) return text;
  return `${headingPath.join(" / ")}\n\n${text}`;
}

function buildBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  const stack: Heading[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    const raw = buffer.join("\n").trim();
    buffer = [];
    if (!raw) return;
    const headingPath = stack.map((h) => h.text);

    // Junk sections (endnotes/bibliography) are metadata, not content. Drop
    // the reference lines but KEEP any non-reference lines that follow the
    // section without a heading boundary — e.g. a book's acknowledgements and
    // the publishing/copyright page that come right after its endnotes.
    if (isJunkSection(headingPath)) {
      const kept = raw
        .split("\n")
        .filter((line) => !looksLikeReferenceLine(line))
        .join("\n")
        .trim();
      if (!kept) return;
      blocks.push({
        kind: isTable(kept) ? "table" : "paragraph",
        text: kept,
        headingPath,
      });
      return;
    }

    // Citation-heavy blocks (footnote pages that have no heading of their
    // own) are noise and must not pollute retrieval.
    if (!isTable(raw) && isReferenceBlock(raw)) return;

    blocks.push({
      kind: isTable(raw) ? "table" : "paragraph",
      text: raw,
      headingPath,
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

    // A blank line after a run of citations closes that run into its own
    // block, so individual endnote entries don't merge with the content that
    // follows them (acknowledgements / publishing details). The block is
    // dropped at flush time by the reference filter above.
    if (
      !lines[i].trim() &&
      buffer.length > 0 &&
      isReferenceBlock(buffer.join("\n"))
    ) {
      flushBuffer();
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

  // Citation/reference lines are never headings. PDFs render endnote entries
  // as "10 Author, Title (Publisher, Year)." — which otherwise matches the
  // numbered-heading pattern below, turning every footnote into a section
  // heading and bypassing the reference-block filter. Reject them first so
  // they stay paragraph content (and get dropped as a reference block).
  if (looksLikeReferenceLine(trimmed)) return null;

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

function isJunkSection(headingPath: string[]): boolean {
  return headingPath.some((heading) => {
    const normalized = heading
      .trim()
      .toLowerCase()
      .replace(/[^a-z ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return (JUNK_SECTION_HEADINGS as readonly string[]).includes(normalized);
  });
}

// Best-effort detection of citation/reference blocks (footnote pages,
// bibliographies, works-cited lists). Works even when the PDF parser flattens
// the "Notes" heading into plain text, so reference lines have no section
// heading to lean on. A block is dropped when a strong majority of its lines
// look like citations — a normal paragraph with one "See …" line survives.
function isReferenceBlock(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  const referenceLines = lines.filter(looksLikeReferenceLine);
  return referenceLines.length / lines.length >= 0.6;
}

function looksLikeReferenceLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 8) return false;

  // Citation keywords that open an endnote entry.
  if (
    /^(?:see|see also|compare|cf\.?|quoted in|quoted from|ibid\.?|op\.? cit\.?)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }

  // "…, Author, Title (Publisher, Year)." / "…(2021, p. 12)." — ends with a
  // parenthesized year, possibly with a page pointer.
  if (
    /\(\s*[^()]*?(?:19|20)\d{2}(?:[a-z]|,\s*(?:p{1,2}\.?|pp\.?|at)\s*[\d.\-\u2013]+)?\s*\)\s*\.?$/i.test(
      trimmed
    )
  ) {
    return true;
  }

  // Ends with a bare year ("…, 2012.") — surname-year citation style.
  if (/[.,]\s*(?:19|20)\d{2}[a-z]?\s*\.?$/.test(trimmed)) return true;

  // Mentions a publisher-ish entity near a parenthesized year.
  if (
    /(?:university press|\bpress\b|publishing|\bbooks?\b|paperbacks?|hardcover|journal of|review of|quarterly|monthly|magazine)\b[\s\S]*?\((?:19|20)\d{2}\s*\)/i.test(
      trimmed
    )
  ) {
    return true;
  }

  // Page pointers at line end: ", p. 12", "pp. 12-14", "at 34".
  if (
    /,\s*(?:p{1,2}\.?|pp\.?|at|n\.?)\s*\d+[-\u2013]?\d*\s*\.?$/.test(trimmed)
  ) {
    return true;
  }

  // Journal style: "42 (2013): 33-44."
  if (/^\d+\s*\(\s*(?:19|20)\d{2}\s*\)\s*:\s*\d+/.test(trimmed)) return true;

  // Numbered citation entry: "10 A. T. Vanderbilt II, Fortune's Children: …",
  // "58 FRED, Federal Reserve Bank of St. Louis.", "40 C. Shapiro and M.
  // Housel, "Disrupting Investors' Own Game," …". Requires a number prefix,
  // one or more capitalized name words (lowercase connectors like "of" or
  // "and" are allowed), a comma right after them, and an uppercase
  // continuation — so ordinary numbered headings ("1. No One's Crazy") and
  // numbered prose ("1. Bill Gates and Kent Evans met …") do not match.
  if (
    /^\d{1,3}[.)]?\s+[A-Z][A-Za-z.'\-]+(?:(?:\s+|\s+and\s+|\s+&\s+)[A-Z][A-Za-z.'\-]+)*\s*,\s*["\u201C\u201D]?[A-Z]/.test(
      trimmed
    )
  ) {
    return true;
  }

  // Numbered endnote that opens with a quoted title: "67 "Minutes of the
  // Federal Open Market Committee," Federal Reserve (October 30–31," and
  // "23 "What is the offer acceptance rate…?" Quora.com.." The note number
  // plus an opening quotation mark is a strong citation signal even when the
  // year is wrapped onto the next line by the PDF extraction.
  if (/^\d{1,3}\s*["\u201C\u201D]/.test(trimmed)) return true;

  // Bare-URL endnote: "68 www.nasa.gov".
  if (/^www\.[A-Za-z0-9.\-/]+/i.test(trimmed)) return true;

  // Numbered bare-URL endnote: "68 www.nhlbi.nih.gov".
  if (/^\d{1,3}[.)]?\s+www\.[A-Za-z0-9.\-/]+/i.test(trimmed)) return true;

  // "2019 Investment Company Factbook, Investment Company Institute." — a
  // citation that opens with a bare year and names an institution/publisher.
  if (
    /(?:19|20)\d{2}\s+[A-Z][A-Za-z'.\-]*(?:\s+[A-Z][A-Za-z'.\-]*)*,\s+.+(?:Institute|Company|University|Press|Corporation|Foundation|Bank|Bureau|Center|Centre|Museum|Journal|Review|Association|Group)\.?$/i.test(
      trimmed
    )
  ) {
    return true;
  }

  // Web citations.
  if (/https?:\/\/\S+\s*\(?access/i.test(trimmed)) return true;
  if (/\b(?:accessed|retrieved)\s+[A-Z][a-z]+\s+\d{1,2},\s*\d{4}\b/i.test(trimmed)) {
    return true;
  }

  return false;
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

// Splits text into sentence-ish fragments WITHOUT ever dropping content.
// The old regex matched `$` as end-of-string, silently discarding every line
// that lacked terminal punctuation ("Copyright © Morgan Housel", addresses,
// captions) when a block had to be hard-split. Splitting per line keeps every
// line — a bare line without punctuation is kept whole; a line with internal
// periods ("harriman-house.com") may split on them, which is cosmetic.
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const matches = trimmed.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g);
    for (const m of matches ?? [trimmed]) {
      const s = m.trim();
      if (s) sentences.push(s);
    }
  }
  return sentences;
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

import pdfParse from "pdf-parse";
import { convertToHtml } from "mammoth";
import { parse as parseHtml } from "node-html-parser";
import ExcelJS from "exceljs";
import type { StructuredBlock, TabularSheet } from "./types";

export type ExtractedContent =
  // PDF, TXT, MD — flattened to plain text; the chunker re-derives structure
  // via regex heuristics (see chunker.ts's deliberate-heuristic-path note).
  | { kind: "text"; text: string; pageCount: number | null }
  // DOCX — real structure (headings/tables/lists) preserved from the source.
  | { kind: "structured"; blocks: StructuredBlock[] }
  // XLSX — row/column structure preserved, chunked separately from prose.
  | { kind: "tabular"; sheets: TabularSheet[] };

export async function extractText(
  mimeType: string,
  buffer: Buffer
): Promise<ExtractedContent> {
  switch (mimeType) {
    case "application/pdf":
      return extractPdf(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractDocx(buffer);
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return extractXlsx(buffer);
    default:
      // text/plain and text/markdown — decoded as UTF-8.
      return { kind: "text", text: buffer.toString("utf8"), pageCount: null };
  }
}

async function extractPdf(buffer: Buffer): Promise<ExtractedContent> {
  const result = await pdfParse(buffer);
  return { kind: "text", text: result.text, pageCount: result.numpages ?? null };
}

// mammoth.convertToHtml() preserves headings/tables/lists (unlike
// extractRawText, which flattens everything to a plain string before the
// chunker ever sees it) — we parse that HTML into typed blocks so the
// chunker can use real structure instead of regex-guessing it back.
async function extractDocx(buffer: Buffer): Promise<ExtractedContent> {
  const result = await convertToHtml({ buffer });
  return { kind: "structured", blocks: htmlToBlocks(result.value) };
}

function htmlToBlocks(html: string): StructuredBlock[] {
  const root = parseHtml(html);
  const blocks: StructuredBlock[] = [];

  for (const el of root.children) {
    const tag = el.tagName?.toLowerCase();
    if (!tag) continue;

    const headingMatch = /^h([1-6])$/.exec(tag);
    if (headingMatch) {
      const text = el.text.trim();
      if (text) blocks.push({ kind: "heading", level: Number(headingMatch[1]), text });
      continue;
    }

    if (tag === "table") {
      // Cells are taken as flattened inner text — a nested block (e.g. a
      // list inside a cell) is not sub-parsed, only its text content.
      const rows: string[][] = [];
      for (const tr of el.querySelectorAll("tr")) {
        const cells = tr.children
          .filter((c) => c.tagName?.toLowerCase() === "td" || c.tagName?.toLowerCase() === "th")
          .map((c) => c.text.trim());
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length > 0) blocks.push({ kind: "table", rows });
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const ordered = tag === "ol";
      for (const li of el.querySelectorAll("li")) {
        const text = li.text.trim();
        if (text) blocks.push({ kind: "list-item", text, ordered });
      }
      continue;
    }

    // "p" and any other block-level tag mammoth might emit (blockquote,
    // etc.) — treated as plain paragraph text so nothing is silently lost.
    const text = el.text.trim();
    if (text) blocks.push({ kind: "paragraph", text });
  }

  return blocks;
}

async function extractXlsx(buffer: Buffer): Promise<ExtractedContent> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const sheets: TabularSheet[] = [];
  for (const worksheet of workbook.worksheets) {
    const rows: string[][] = [];
    let headers: string[] = [];
    worksheet.eachRow((row, rowNumber) => {
      const values = cellsToStrings(row.values as ExcelJS.CellValue[]);
      if (rowNumber === 1) {
        headers = values;
      } else {
        rows.push(values);
      }
    });
    if (headers.length > 0 || rows.length > 0) {
      sheets.push({ name: worksheet.name, headers, rows });
    }
  }

  return { kind: "tabular", sheets };
}

// ExcelJS's Row.values is a sparse array where index 0 is unused (columns
// are 1-indexed) — drop it and stringify each cell.
function cellsToStrings(values: ExcelJS.CellValue[]): string[] {
  return values.slice(1).map((v) => cellToString(v));
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // Rich text / formula result objects — best-effort flatten.
    if ("text" in value) return String((value as { text: unknown }).text);
    if ("result" in value) return String((value as { result: unknown }).result);
    return "";
  }
  return String(value);
}

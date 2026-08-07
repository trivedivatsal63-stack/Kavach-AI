import pdfParse from "pdf-parse";
import { extractRawText } from "mammoth";

export interface ExtractedText {
  text: string;
  // Page count is captured when the format exposes it; page-level markers
  // inside the text stream are not (see chunker notes). null when unknown.
  pageCount: number | null;
}

export async function extractText(
  mimeType: string,
  buffer: Buffer
): Promise<ExtractedText> {
  switch (mimeType) {
    case "application/pdf":
      return extractPdf(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractDocx(buffer);
    default:
      // text/plain and text/markdown — decoded as UTF-8.
      return { text: buffer.toString("utf8"), pageCount: null };
  }
}

async function extractPdf(buffer: Buffer): Promise<ExtractedText> {
  const result = await pdfParse(buffer);
  return { text: result.text, pageCount: result.numpages ?? null };
}

async function extractDocx(buffer: Buffer): Promise<ExtractedText> {
  const result = await extractRawText({ buffer });
  return { text: result.value, pageCount: null };
}

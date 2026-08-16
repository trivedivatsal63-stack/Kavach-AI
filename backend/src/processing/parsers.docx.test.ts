import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractText } from "./parsers";
import { chunkStructuredBlocks } from "./chunker";

// sample.docx is a hand-built OOXML zip (see scratchpad build script used to
// generate it) containing a real H1 > H2 heading nest and a 3-row table —
// exercises actual mammoth.convertToHtml() output, not a mocked string.
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const fixturePath = join(__dirname, "__fixtures__", "sample.docx");

describe("DOCX structured extraction", () => {
  it("extracts real heading levels and table rows from the source document", async () => {
    const buffer = readFileSync(fixturePath);
    const extracted = await extractText(DOCX_MIME, buffer);

    expect(extracted.kind).toBe("structured");
    if (extracted.kind !== "structured") return;

    const kinds = extracted.blocks.map((b) => b.kind);
    expect(kinds).toEqual(["heading", "heading", "paragraph", "table"]);

    const [h1, h2] = extracted.blocks;
    expect(h1).toEqual({ kind: "heading", level: 1, text: "Project Report" });
    expect(h2).toEqual({ kind: "heading", level: 2, text: "Budget Table" });

    const table = extracted.blocks[3];
    expect(table.kind).toBe("table");
    if (table.kind !== "table") return;
    expect(table.rows).toEqual([
      ["Quarter", "Amount"],
      ["Q1", "4200"],
      ["Q2", "5100"],
    ]);
  });

  it("chunks reflect the real heading nesting and table content — not a regex guess", async () => {
    const buffer = readFileSync(fixturePath);
    const extracted = await extractText(DOCX_MIME, buffer);
    if (extracted.kind !== "structured") throw new Error("expected structured extraction");

    const chunks = chunkStructuredBlocks(extracted.blocks);
    expect(chunks.length).toBeGreaterThan(0);

    // The table chunk must sit under the real H1 > H2 path (proves the
    // heading stack came from actual <h1>/<h2> tags, not detectHeading()'s
    // regex heuristics — a flattened-text guess has no way to know "Budget
    // Table" is a sub-heading of "Project Report" rather than a sibling).
    const tableChunk = chunks.find((c) => c.content.includes("Quarter"));
    expect(tableChunk).toBeDefined();
    expect(tableChunk!.headingPath).toEqual(["Project Report", "Budget Table"]);

    // Row order preserved in the serialized table content.
    const quarterIdx = tableChunk!.content.indexOf("Quarter");
    const q1Idx = tableChunk!.content.indexOf("Q1");
    const q2Idx = tableChunk!.content.indexOf("Q2");
    expect(quarterIdx).toBeGreaterThanOrEqual(0);
    expect(q1Idx).toBeGreaterThan(quarterIdx);
    expect(q2Idx).toBeGreaterThan(q1Idx);

    // The prose paragraph sits under the same H1 > H2 path too.
    const proseChunk = chunks.find((c) => c.content.includes("engineering team"));
    expect(proseChunk).toBeDefined();
    expect(proseChunk!.headingPath).toEqual(["Project Report", "Budget Table"]);
  });
});
